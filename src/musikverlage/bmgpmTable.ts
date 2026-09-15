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

export function parseBmgpmHeaderRow(headers: unknown[]): BmgpmHeaderMap | null {
  const h = headers.map((x) => normBmgpmHeader(cellStr(x)));
  if (h.length === 0) return null;

  const find = (variants: string[]): number | null => {
    const i = h.findIndex((x) => headerMatches(x, variants));
    return i >= 0 ? i : null;
  };

  const writerPairs = new Map<number, { first: number; last: number }>();
  for (let c = 0; c < h.length; c++) {
    const col = h[c]!;
    const m =
      col.match(/^writer:(\d+):first\s*name$/) ??
      col.match(/^writer:(\d+)\s+first\s*name$/) ??
      col.match(/^writer:(\d+):firstname$/);
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
      col.match(/^writer:(\d+):lastname$/);
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

  const trackAudioFilenameIdx = find([
    "track:audio filename",
    "track audio filename",
    "track:audio file name",
    "track: file name",
    "track:filename",
  ]);
  const albumReleaseDateIdx = find([
    "album:release date",
    "album release date",
    "album: release date",
  ]);
  const albumCodeIdx = find(["album:code", "album code"]);
  const albumTitleIdx = find(["album:title", "album title"]);
  const albumDisplayTitleIdx = find(["album:display title", "album display title"]);
  const trackTitleIdx = find(["track:title", "track title"]);
  const trackArtistIdx = find(["track:artist", "track artist"]);
  const trackArtistsIdx = find(["track:artist(s)", "track artist(s)", "track.artist(s)"]);
  const trackComposersIdx = find(["track:composers", "track composers", "track:composer(s)"]);
  const libraryNameIdx = find(["library:name", "library name"]);
  const isrcIdx = find(["track:isrc", "isrc", "track isrc"]);

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

/** ISO-Datum YYYY-MM-DD oder null. */
export function parseBmgpmReleaseDate(raw: unknown): string | null {
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
