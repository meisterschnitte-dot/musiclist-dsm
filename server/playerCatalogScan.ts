import fs from "node:fs/promises";
import path from "node:path";
import {
  PLAYER_TRACK_TAGS_VER,
  playerCatalogDeleteById,
  playerCatalogExistingStat,
  playerCatalogGetById,
  playerCatalogNullDurationRows,
  playerCatalogRebuildFtsIfNeeded,
  playerCatalogTrackCount,
  playerCatalogUpsertTrack,
  playerCatalogWriteTags,
  type PlayerTrackRow,
  type PlayerTrackTags,
} from "./playerCatalogSqlite";
import { resolveStoredTrackPath } from "./playerCatalogSettings";
import { probePlayableAudio } from "./playerAudioPlayable";
import { findGvlEntryByLabelcode, getGvlLookupMap, type GvlLabelEntry } from "./gvlLabelFs";
import { readId3RawPreferredTextFields } from "../src/audio/readId3RawTextFrames";
import { labelcodeWithLcPrefix } from "../src/blankframeSearch";

const AUDIO_EXT = new Set([".mp3", ".wav", ".wave", ".m4a", ".flac", ".ogg"]);
const SKIP_DIR = new Set(["$recycle.bin", "system volume information", ".git", "node_modules"]);
const ID3_HEAD_BYTES = 512 * 1024;
const SKIPPED_TRACK_LIST_CAP = 500;

export type PlayerScanStatus = {
  running: boolean;
  processed: number;
  upserted: number;
  skipped: number;
  removed: number;
  total: number;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  skippedTracks: string[];
  addedTracks: string[];
  rejected: number;
  rejectedTracks: string[];
};

const status: PlayerScanStatus = {
  running: false,
  processed: 0,
  upserted: 0,
  skipped: 0,
  rejected: 0,
  removed: 0,
  total: 0,
  error: null,
  startedAt: null,
  finishedAt: null,
  skippedTracks: [],
  addedTracks: [],
  rejectedTracks: [],
};

const EMPTY_TAGS: PlayerTrackTags = {
  title: "",
  artist: "",
  album: "",
  year: "",
  genre: "",
  writer: "",
  publisher: "",
  label: "",
  labelcode: "",
  gvlRights: "",
  comment: "",
  isrc: "",
};

function rememberRejected(label: string): void {
  status.rejected += 1;
  if (status.rejectedTracks.length < SKIPPED_TRACK_LIST_CAP) status.rejectedTracks.push(label);
}

async function rejectUnplayableExisting(report: boolean): Promise<void> {
  for (const row of playerCatalogNullDurationRows()) {
    const probe = await probePlayableAudio(row.relPath);
    if (probe.ok) continue;
    playerCatalogDeleteById(row.id);
    if (report) rememberRejected(`${(row.title || row.fileName).trim()} — ${probe.reason}`);
  }
}

let quietPurgeStarted = false;
export function getPlayerScanStatus(): PlayerScanStatus {
  if (!quietPurgeStarted) {
    quietPurgeStarted = true;
    void rejectUnplayableExisting(false);
  }
  return {
    ...status,
    total: playerCatalogTrackCount(),
    skippedTracks: [...status.skippedTracks],
    addedTracks: [...status.addedTracks],
    rejectedTracks: [...status.rejectedTracks],
  };
}

function isAudioFile(name: string): boolean {
  const ext = path.extname(name).toLowerCase();
  return AUDIO_EXT.has(ext);
}

async function walkFiles(root: string, onFile: (abs: string) => Promise<void>): Promise<void> {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true, encoding: "utf8" });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const name = String(ent.name);
      if (name.startsWith(".") && name !== ".") continue;
      if (ent.isDirectory()) {
        if (SKIP_DIR.has(name.toLowerCase())) continue;
        stack.push(path.join(dir, name));
        continue;
      }
      if (!ent.isFile() || !isAudioFile(name)) continue;
      await onFile(path.join(dir, name));
    }
  }
}

function firstComment(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return "";
  const first = value[0];
  if (typeof first === "string") return first.trim();
  if (first && typeof first === "object" && "text" in first) {
    const t = (first as { text?: unknown }).text;
    return typeof t === "string" ? t.trim() : "";
  }
  return "";
}

function tagText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter(Boolean)
      .join(", ");
  }
  if (value && typeof value === "object" && "text" in value) {
    const t = (value as { text?: unknown }).text;
    return typeof t === "string" ? t.trim() : "";
  }
  return "";
}

const TXXX_TO_FIELD: Record<string, keyof PlayerTrackTags> = {
  writer: "writer",
  publisher: "publisher",
  hersteller: "publisher",
  label: "label",
  labelcode: "labelcode",
  "gvl rights": "gvlRights",
  "rechterückruf": "gvlRights",
  comment: "comment",
  comments: "comment",
  isrc: "isrc",
};

function applyNativeTags(out: PlayerTrackTags, native: Record<string, Array<{ id?: unknown; value?: unknown }>> | undefined): void {
  if (!native) return;
  for (const tags of Object.values(native)) {
    for (const tag of tags) {
      const sid = typeof tag.id === "string" ? tag.id : "";
      const text = tagText(tag.value);
      if (!sid || !text) continue;
      if (sid === "TCOM" || sid === "TOLY" || sid === "TCM") {
        if (!out.writer) out.writer = text;
        continue;
      }
      if (sid === "TPUB" || sid === "TPB") {
        if (!out.publisher) out.publisher = text;
        continue;
      }
      if (sid === "LACO") {
        if (!out.labelcode) out.labelcode = text;
        continue;
      }
      const colon = sid.indexOf(":");
      if (!sid.toUpperCase().startsWith("TXXX") || colon < 0) continue;
      const key = TXXX_TO_FIELD[sid.slice(colon + 1).trim().toLowerCase()];
      if (!key || out[key]) continue;
      out[key] = text;
    }
  }
}

async function readFileHead(abs: string, maxBytes: number): Promise<Uint8Array> {
  const fh = await fs.open(abs, "r");
  try {
    const st = await fh.stat();
    const n = Math.min(maxBytes, Number(st.size) || 0);
    if (n <= 0) return new Uint8Array();
    const buf = Buffer.alloc(n);
    const { bytesRead } = await fh.read(buf, 0, n, 0);
    return new Uint8Array(buf.buffer, buf.byteOffset, bytesRead);
  } finally {
    await fh.close();
  }
}

async function readTags(
  abs: string,
  opts: { duration: boolean }
): Promise<PlayerTrackTags & { durationSec: number | null }> {
  const out: PlayerTrackTags = { ...EMPTY_TAGS };
  let durationSec: number | null = null;
  try {
    const { parseFile, parseBuffer } = await import("music-metadata");
    const ext = path.extname(abs).toLowerCase();
    const meta =
      opts.duration || ext !== ".mp3"
        ? await parseFile(abs, { duration: opts.duration, skipCovers: true })
        : await parseBuffer(await readFileHead(abs, ID3_HEAD_BYTES), "audio/mpeg", {
            duration: false,
            skipCovers: true,
          });
    const c = meta.common;
    out.title = (c.title ?? "").trim();
    out.artist = (c.artist ?? c.artists?.[0] ?? "").trim();
    out.album = (c.album ?? "").trim();
    out.year = c.year != null ? String(c.year) : "";
    out.genre = (c.genre?.[0] ?? "").trim();
    out.writer = tagText(c.composer);
    out.comment = firstComment(c.comment);
    out.isrc = tagText(c.isrc);
    const dur = meta.format.duration;
    if (typeof dur === "number" && Number.isFinite(dur) && dur > 0) durationSec = dur;
    applyNativeTags(out, meta.native as Record<string, Array<{ id?: unknown; value?: unknown }>> | undefined);
  } catch {
    /* Roh-ID3 unten */
  }
  try {
    const head = await readFileHead(abs, ID3_HEAD_BYTES);
    const raw = readId3RawPreferredTextFields(head);
    if (raw.composer) out.writer = raw.composer;
    if (raw.artist) out.artist = raw.artist;
    if (raw.hersteller) out.publisher = raw.hersteller;
    if (raw.label) out.label = raw.label;
    if (raw.labelcode) out.labelcode = raw.labelcode;
    if (raw.gvlRechte) out.gvlRights = raw.gvlRechte;
    if (raw.isrc) out.isrc = raw.isrc;
  } catch {
    /* Datei ohne ID3 */
  }
  if (out.labelcode) {
    const lc = labelcodeWithLcPrefix(out.labelcode);
    if (lc) out.labelcode = lc;
  }
  return { ...out, durationSec };
}

function applyGvlToPlayerTags(tags: PlayerTrackTags, gvlMap: Map<string, GvlLabelEntry>): PlayerTrackTags {
  const lc = tags.labelcode.trim();
  if (!lc || gvlMap.size === 0) return tags;
  const hit = findGvlEntryByLabelcode(gvlMap, lc);
  if (!hit) return tags;
  return {
    ...tags,
    label: hit.label.trim(),
    publisher: hit.hersteller.trim(),
    gvlRights: hit.rechterueckrufe.trim(),
  };
}

export async function refreshStalePlayerTrackTags(tracks: PlayerTrackRow[]): Promise<PlayerTrackRow[]> {
  const gvlMap = await getGvlLookupMap();
  const out: PlayerTrackRow[] = [];
  for (const track of tracks) {
    if (track.tagsVer >= PLAYER_TRACK_TAGS_VER) {
      if (track.labelcode.trim()) {
        const next = applyGvlToPlayerTags(track, gvlMap);
        if (
          next.label !== track.label ||
          next.publisher !== track.publisher ||
          next.gvlRights !== track.gvlRights
        ) {
          out.push(playerCatalogWriteTags(track.id, next) ?? track);
          continue;
        }
      }
      out.push(track);
      continue;
    }
    let abs: string | null = null;
    try {
      abs = resolveStoredTrackPath(track.relPath);
    } catch {
      abs = null;
    }
    if (!abs) {
      playerCatalogWriteTags(track.id, {
        title: track.title,
        artist: track.artist,
        album: track.album,
        year: track.year,
        genre: track.genre,
        writer: track.writer,
        publisher: track.publisher,
        label: track.label,
        labelcode: track.labelcode,
        gvlRights: track.gvlRights,
        comment: track.comment,
        isrc: track.isrc,
      });
      out.push(playerCatalogGetById(track.id) ?? track);
      continue;
    }
    const tags = applyGvlToPlayerTags(await readTags(abs, { duration: false }), gvlMap);
    const written = playerCatalogWriteTags(track.id, {
      title: tags.title || track.title,
      artist: tags.artist || track.artist,
      album: tags.album || track.album,
      year: tags.year || track.year,
      genre: tags.genre || track.genre,
      writer: tags.writer,
      publisher: tags.publisher,
      label: tags.label,
      labelcode: tags.labelcode,
      gvlRights: tags.gvlRights,
      comment: tags.comment,
      isrc: tags.isrc,
    });
    out.push(written ?? track);
  }
  return out;
}

async function importOneFile(abs: string, gvlMap: Map<string, GvlLabelEntry>): Promise<boolean> {
  let st;
  try {
    st = await fs.stat(abs);
  } catch {
    return false;
  }
  if (!st.isFile()) return false;
  const stored = path.resolve(abs);
  const prev = playerCatalogExistingStat(stored);
  status.processed += 1;
  const probe = await probePlayableAudio(stored);
  if (!probe.ok) {
    if (prev) playerCatalogDeleteById(prev.id);
    rememberRejected(`${(prev?.title || prev?.fileName || path.basename(stored)).trim()} — ${probe.reason}`);
    return false;
  }
  if (prev) {
    const row = playerCatalogGetById(prev.id);
    if (row?.labelcode) {
      const next = applyGvlToPlayerTags(row, gvlMap);
      if (
        next.label !== row.label ||
        next.publisher !== row.publisher ||
        next.gvlRights !== row.gvlRights
      ) {
        playerCatalogWriteTags(row.id, next);
      }
    }
    const label = (prev.title || prev.fileName || path.basename(stored)).trim();
    status.skipped += 1;
    if (status.skippedTracks.length < SKIPPED_TRACK_LIST_CAP) status.skippedTracks.push(label);
    return false;
  }
  const tags = applyGvlToPlayerTags(await readTags(stored, { duration: true }), gvlMap);
  const label = (tags.title || path.basename(stored)).trim();
  playerCatalogUpsertTrack({
    relPath: stored,
    fileName: path.basename(stored),
    folder: path.dirname(stored),
    title: tags.title,
    artist: tags.artist,
    album: tags.album,
    year: tags.year,
    genre: tags.genre,
    writer: tags.writer,
    publisher: tags.publisher,
    label: tags.label,
    labelcode: tags.labelcode,
    gvlRights: tags.gvlRights,
    comment: tags.comment,
    isrc: tags.isrc,
    durationSec: tags.durationSec,
    fileSize: st.size,
    mtimeMs: Math.floor(st.mtimeMs),
  });
  status.upserted += 1;
  if (status.addedTracks.length < SKIPPED_TRACK_LIST_CAP) status.addedTracks.push(label);
  if (status.processed % 25 === 0) {
    await new Promise<void>((r) => setImmediate(r));
  }
  return true;
}

export function startPlayerCatalogImport(rawPaths: string[]): PlayerScanStatus {
  if (status.running) throw new Error("Ein Import läuft bereits.");
  const paths = rawPaths.map((p) => p.trim()).filter(Boolean);
  if (!paths.length) throw new Error("Bitte Ordner oder Dateien auswählen.");
  void runPlayerCatalogImport(paths);
  return getPlayerScanStatus();
}

async function runPlayerCatalogImport(rawPaths: string[]): Promise<void> {
  if (status.running) return;
  status.running = true;
  status.processed = 0;
  status.upserted = 0;
  status.skipped = 0;
  status.rejected = 0;
  status.skippedTracks = [];
  status.addedTracks = [];
  status.rejectedTracks = [];
  status.removed = 0;
  status.error = null;
  status.startedAt = new Date().toISOString();
  status.finishedAt = null;
  try {
    await rejectUnplayableExisting(true);
    const gvlMap = await getGvlLookupMap();
    for (const raw of rawPaths) {
      const abs = path.resolve(raw);
      let st;
      try {
        st = await fs.stat(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        await walkFiles(abs, async (fileAbs) => {
          await importOneFile(fileAbs, gvlMap);
        });
        continue;
      }
      if (st.isFile() && AUDIO_EXT.has(path.extname(abs).toLowerCase())) {
        await importOneFile(abs, gvlMap);
      }
    }
    playerCatalogRebuildFtsIfNeeded();
    status.total = playerCatalogTrackCount();
  } catch (e) {
    status.error = e instanceof Error ? e.message : "Import fehlgeschlagen.";
  } finally {
    status.running = false;
    status.finishedAt = new Date().toISOString();
  }
}
