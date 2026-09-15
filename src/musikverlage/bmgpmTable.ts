import { clipBmgPmSearchFromFilename } from "../bmgProductionMusic";
import { basenamePath } from "../tracks/sanitizeFilename";
import type { WcpmTagPayload } from "./wcpmTable";
import { wcpmFilenameStem, wcpmFilenameStemAlnumKey, wcpmFilenameStemMatchKey } from "./wcpmTable";

function cellStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return String(v).trim();
}

/** Excel-Überschrift vereinheitlichen (Leerzeichen, Doppelpunkt). */
export function normBmgpmHeader(h: string): string {
  return h
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\s*:\s*/g, ":");
}

export type BmgpmHeaderMap = {
  trackAudioFilenameIdx: number | null;
  albumReleaseDateIdx: number | null;
  albumCodeIdx: number | null;
  albumTitleIdx: number | null;
  albumDisplayTitleIdx: number | null;
  trackTitleIdx: number | null;
  trackArtistIdx: number | null;
  trackArtistsIdx: number | null;
  trackComposersIdx: number | null;
  libraryNameIdx: number | null;
  isrcIdx: number | null;
  writerPairs: Map<number, { first: number; last: number }>;
};

function headerMatches(norm: string, variants: string[]): boolean {
  return variants.some((v) => norm === v || norm.replace(/\./g, "") === v.replace(/\./g, ""));
}

function findCol(h: string[], variants: string[], pred?: (norm: string) => boolean): number | null {
  const i = h.findIndex((x) => headerMatches(x, variants) || (pred ? pred(x) : false));
  return i >= 0 ? i : null;
}

/** Kopfzeile steht oft nicht in Zeile 1 (Metadaten, Leerzeilen). */
export function findBmgpmHeaderRowIndex(rows: unknown[][]): number | null {
  const max = Math.min(rows.length, 40);
  for (let r = 0; r < max; r++) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;
    if (parseBmgpmHeaderRow(row) != null) return r;
  }
  return null;
}

export function formatBmgpmHeaderPreview(headers: unknown[], maxCols = 8): string {
  const parts = headers
    .slice(0, maxCols)
    .map((x) => cellStr(x))
    .filter(Boolean);
  return parts.length ? parts.join(" | ") : "(leer)";
}

export function parseBmgpmHeaderRow(headers: unknown[]): BmgpmHeaderMap | null {
  const h = headers.map((x) => normBmgpmHeader(cellStr(x)));
  if (h.length === 0) return null;

  const find = (variants: string[], pred?: (norm: string) => boolean): number | null =>
    findCol(h, variants, pred);

  const writerPairs = new Map<number, { first: number; last: number }>();
  for (let c = 0; c < h.length; c++) {
    const col = h[c]!;
    const m =
      col.match(/^writer:(\d+):first\s*name$/) ??
      col.match(/^writer:(\d+)\s+first\s*name$/) ??
      col.match(/^writer:(\d+):firstname$/) ??
      col.match(/^writer:(\d+)\s+firstname$/);
    if (m) {
      const n = Number.parseInt(m[1]!, 10);
      const cur = writerPairs.get(n) ?? { first: -1, last: -1 };
      cur.first = c;
      writerPairs.set(n, cur);
      continue;
    }
    const m2 =
      col.match(/^writer:(\d+):last\s*name$/) ??
      col.match(/^writer:(\d+)\s+last\s*name$/) ??
      col.match(/^writer:(\d+):lastname$/) ??
      col.match(/^writer:(\d+)\s+lastname$/);
    if (m2) {
      const n = Number.parseInt(m2[1]!, 10);
      const cur = writerPairs.get(n) ?? { first: -1, last: -1 };
      cur.last = c;
      writerPairs.set(n, cur);
    }
  }
  for (const [n, p] of [...writerPairs.entries()]) {
    if (p.first < 0 && p.last < 0) writerPairs.delete(n);
  }

  const trackAudioFilenameIdx =
    find([
      "track:audio filename",
      "track audio filename",
      "track:audio file name",
      "track: file name",
      "track:filename",
      "file name",
      "filename",
      "original file name",
    ]) ??
    find([], (x) => /track[.:].*audio.*file/.test(x) || /^file\s*name$/.test(x));
  const albumReleaseDateIdx =
    find(["album:release date", "album release date"]) ??
    find([], (x) => /album[.:].*release.*date/.test(x));
  const albumCodeIdx =
    find(["album:code", "album code"]) ?? find([], (x) => /album[.:].*code/.test(x) && !/barcode/.test(x));
  const albumTitleIdx =
    find(["album:title", "album title"]) ??
    find([], (x) => /album[.:]title/.test(x) && !/display/.test(x));
  const albumDisplayTitleIdx =
    find(["album:display title", "album display title"]) ??
    find([], (x) => /album[.:].*display.*title/.test(x));
  const trackTitleIdx =
    find(["track:title", "track title", "tracktitle"]) ??
    find([], (x) => /track[.:]title/.test(x) && !/version/.test(x));
  const trackArtistIdx =
    find(["track:artist", "track artist"]) ?? find([], (x) => /^track[.:]artist$/.test(x));
  const trackArtistsIdx =
    find(["track:artist(s)", "track artist(s)", "track.artist(s)", "track:artists"]) ??
    find([], (x) => /track[.:].*artist/.test(x) && /\(s\)|artists/.test(x));
  const trackComposersIdx =
    find(["track:composers", "track composers", "track:composer(s)", "track:composer"]) ??
    find([], (x) => /track[.:].*composer/.test(x));
  const libraryNameIdx =
    find(["library:name", "library name", "catalog:name", "catalog name"]) ??
    find([], (x) => /^library[.:]name/.test(x) || x === "catalog");
  const isrcIdx =
    find(["track:isrc", "isrc", "track isrc"]) ?? find([], (x) => x === "isrc" || /track[.:]isrc/.test(x));

  if (
    trackAudioFilenameIdx == null &&
    albumCodeIdx == null &&
    trackTitleIdx == null
  ) {
    return null;
  }

  return {
    trackAudioFilenameIdx,
    albumReleaseDateIdx,
    albumCodeIdx,
    albumTitleIdx,
    albumDisplayTitleIdx,
    trackTitleIdx,
    trackArtistIdx,
    trackArtistsIdx,
    trackComposersIdx,
    libraryNameIdx,
    isrcIdx,
    writerPairs,
  };
}

function excelSerialToIso(n: number): string | null {
  if (!Number.isFinite(n) || n < 1) return null;
  const ms = Math.round((n - 25569) * 86400 * 1000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** ISO-Datum YYYY-MM-DD oder null. */
export function parseBmgpmReleaseDate(raw: unknown): string | null {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw.toISOString().slice(0, 10);
  }
  if (typeof raw === "number" && raw > 2000) {
    const fromSerial = excelSerialToIso(raw);
    if (fromSerial) return fromSerial;
  }
  const t = cellStr(raw);
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const dmY = t.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (dmY) {
    const d = dmY[1]!.padStart(2, "0");
    const mo = dmY[2]!.padStart(2, "0");
    return `${dmY[3]}-${mo}-${d}`;
  }
  const parsed = new Date(t);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  const y = t.match(/\b(19|20)\d{2}-\d{2}-\d{2}\b/);
  if (y) return y[0]!.slice(0, 10);
  return null;
}

function splitNameList(s: string): string[] {
  return s
    .split(/[;,|/]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function dedupeNames(names: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const key = n.toLowerCase().replace(/\s+/g, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(n.trim());
  }
  return out.join("; ");
}

function buildWriters(map: BmgpmHeaderMap, row: unknown[]): string[] {
  const ns = [...map.writerPairs.keys()].sort((a, b) => a - b);
  const parts: string[] = [];
  for (const n of ns) {
    const p = map.writerPairs.get(n)!;
    const fn = p.first >= 0 ? cellStr(row[p.first]) : "";
    const ln = p.last >= 0 ? cellStr(row[p.last]) : "";
    const one = [fn, ln].filter(Boolean).join(" ").trim();
    if (one) parts.push(one);
  }
  return parts;
}

function pickAlbumTitle(map: BmgpmHeaderMap, row: unknown[]): string {
  if (map.albumTitleIdx != null && map.albumTitleIdx < row.length) {
    const t = cellStr(row[map.albumTitleIdx]);
    if (t) return t;
  }
  if (map.albumDisplayTitleIdx != null && map.albumDisplayTitleIdx < row.length) {
    return cellStr(row[map.albumDisplayTitleIdx]);
  }
  return "";
}

function pickArtist(map: BmgpmHeaderMap, row: unknown[]): string {
  const parts: string[] = [];
  if (map.trackArtistsIdx != null && map.trackArtistsIdx < row.length) {
    parts.push(...splitNameList(cellStr(row[map.trackArtistsIdx])));
  }
  if (map.trackArtistIdx != null && map.trackArtistIdx < row.length) {
    parts.push(...splitNameList(cellStr(row[map.trackArtistIdx])));
  }
  return dedupeNames(parts);
}

function pickComposer(map: BmgpmHeaderMap, row: unknown[]): string {
  const parts: string[] = [];
  if (map.trackComposersIdx != null && map.trackComposersIdx < row.length) {
    parts.push(...splitNameList(cellStr(row[map.trackComposersIdx])));
  }
  parts.push(...buildWriters(map, row));
  return dedupeNames(parts);
}

export function bmgpmRowKeyFromRow(map: BmgpmHeaderMap, row: unknown[]): string | null {
  if (map.trackAudioFilenameIdx != null && map.trackAudioFilenameIdx < row.length) {
    const fn = cellStr(row[map.trackAudioFilenameIdx]);
    if (fn) {
      const stem = wcpmFilenameStem(fn);
      if (stem) return stem;
    }
  }
  const code =
    map.albumCodeIdx != null && map.albumCodeIdx < row.length
      ? cellStr(row[map.albumCodeIdx]).toLowerCase()
      : "";
  const title =
    map.trackTitleIdx != null && map.trackTitleIdx < row.length
      ? cellStr(row[map.trackTitleIdx]).toLowerCase()
      : "";
  if (code && title) return `${code}|${title}`;
  if (title) return title;
  return null;
}

export function bmgpmRowToTagPayload(map: BmgpmHeaderMap, row: unknown[]): WcpmTagPayload | null {
  const rowKey = bmgpmRowKeyFromRow(map, row);
  if (!rowKey) return null;
  const trackAudio =
    map.trackAudioFilenameIdx != null && map.trackAudioFilenameIdx < row.length
      ? cellStr(row[map.trackAudioFilenameIdx])
      : "";
  const albumCode =
    map.albumCodeIdx != null && map.albumCodeIdx < row.length
      ? cellStr(row[map.albumCodeIdx])
      : "";
  const releaseDate =
    map.albumReleaseDateIdx != null && map.albumReleaseDateIdx < row.length
      ? parseBmgpmReleaseDate(row[map.albumReleaseDateIdx]) ?? undefined
      : undefined;
  const library =
    map.libraryNameIdx != null && map.libraryNameIdx < row.length
      ? cellStr(row[map.libraryNameIdx])
      : "";
  const isrc =
    map.isrcIdx != null && map.isrcIdx < row.length ? cellStr(row[map.isrcIdx]) : "";

  return {
    songTitle:
      map.trackTitleIdx != null && map.trackTitleIdx < row.length
        ? cellStr(row[map.trackTitleIdx])
        : "",
    artist: pickArtist(map, row),
    album: pickAlbumTitle(map, row),
    composer: pickComposer(map, row),
    isrc,
    labelcode: "",
    label: library || undefined,
    albumCode: albumCode || undefined,
    releaseDate,
    trackAudioFilename: trackAudio || undefined,
    albumDisplayTitle:
      map.albumDisplayTitleIdx != null && map.albumDisplayTitleIdx < row.length
        ? cellStr(row[map.albumDisplayTitleIdx]) || undefined
        : undefined,
  };
}

export function extractBmgpmCatalogCodeFromFileName(fileName: string): string | null {
  const clip = clipBmgPmSearchFromFilename(fileName);
  if (!clip) return null;
  const code = clip.split(/\s+/)[0]?.trim();
  return code || null;
}

export { wcpmFilenameStem, wcpmFilenameStemMatchKey, wcpmFilenameStemAlnumKey, basenamePath };
