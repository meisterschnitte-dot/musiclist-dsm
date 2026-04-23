import { labelcodeWithLcPrefix } from "../blankframeSearch";
import { basenamePath } from "../tracks/sanitizeFilename";

const AUDIO_EXTS = [".mp3", ".wav", ".flac", ".aif", ".aiff", ".m4a", ".aac", ".ogg"] as const;

/** Stamm ohne gängige Audio-Endung — Abgleich .wav (Tabelle) vs. .mp3 (lokal). */
function stripAudioExtensionForMatch(filename: string): string {
  const lower = filename.toLowerCase();
  for (const ext of AUDIO_EXTS) {
    if (lower.endsWith(ext)) return filename.slice(0, -ext.length);
  }
  return filename;
}

function cellStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return String(v).trim();
}

/** Dateiname ohne Endung, kleingeschrieben — Abgleich .mp3 vs .wav. */
export function wcpmFilenameStem(pathOrFileName: string): string {
  const base = basenamePath(pathOrFileName.trim());
  return stripAudioExtensionForMatch(base).trim().toLowerCase();
}

/**
 * Fehlertoleranter Vergleichsschlüssel für WCPM-Dateinamen.
 * Ignoriert Trennzeichen wie Leerzeichen/Unterstrich/Bindestrich:
 * `AA273_01_Pure Energy` == `AA273 01 Pure Energy`, ebenso `CAR439_014` == `CAR439 014` am Stück.
 * (NFKC: Excel/Zwischenablage; einheitliche Bindestrich-Varianten.)
 */
export function wcpmFilenameStemMatchKey(pathOrFileName: string): string {
  const stem = wcpmFilenameStem(pathOrFileName);
  if (!stem) return "";
  let s = stem.normalize("NFKC");
  s = s.replace(
    /[\u2010-\u2015\u2212\ufe58\ufe63\uff0d]/g,
    "-"
  );
  s = s.replace(/[\s_-]+/g, "");
  return s;
}

/**
 * Notfall-Abgleich, wenn Trennzeichen außerhalb des üblichen Musters liegen
 * (z. B. Geviertstrich/Unicode); nur a–z/0–9, alle Kleinbuchstaben, keine Leerzeichen.
 * Zwei Kennungen wie `CAR439_014` und `CAR439 014` führen auf denselben Schlüssel.
 */
export function wcpmFilenameStemAlnumKey(pathOrFileName: string): string {
  const stem = wcpmFilenameStem(pathOrFileName);
  if (!stem) return "";
  return stem
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export type WcpmHeaderMap = {
  filenameCol: number;
  labelcodeIdx: number | null;
  tracktitleIdx: number | null;
  isrcIdx: number | null;
  cdtitleIdx: number | null;
  composerIdx: number | null;
  /** COM-Gruppe n → Spaltenindizes FirstName / LastName */
  comPairs: Map<number, { first: number; last: number }>;
};

function normHeader(h: string): string {
  return h.replace(/\s+/g, " ").trim();
}

/**
 * Erkennt Spalten aus der ersten Zeile (Überschriften).
 * Erste Spalte = Dateiname (laut WCPM-Lieferung).
 */
export function parseWcpmHeaderRow(headers: unknown[]): WcpmHeaderMap | null {
  const h = headers.map((x) => normHeader(cellStr(x)));
  if (h.length === 0) return null;
  const find = (pred: (s: string) => boolean): number | null => {
    const i = h.findIndex(pred);
    return i >= 0 ? i : null;
  };
  const filenameCol = find((s) => /^filename$/i.test(s)) ?? 0;
  const labelcodeIdx = find((s) => /^labelcode$/i.test(s));
  const tracktitleIdx = find((s) => /^tracktitle$/i.test(s) || /^track title$/i.test(s));
  const isrcIdx = find((s) => /^isrc$/i.test(s));
  const cdtitleIdx = find((s) => /^cdtitle$/i.test(s) || /^cd title$/i.test(s));
  const composerIdx = find((s) => /^composer$/i.test(s));

  const comPairs = new Map<number, { first: number; last: number }>();
  const reCom = /^COM:(\d+):(FirstName|LastName)$/i;
  for (let c = 0; c < h.length; c++) {
    const m = h[c]!.match(reCom);
    if (!m) continue;
    const n = Number.parseInt(m[1]!, 10);
    if (!Number.isFinite(n) || n < 1) continue;
    const kind = m[2]!.toLowerCase();
    const cur = comPairs.get(n) ?? { first: -1, last: -1 };
    if (kind === "firstname") cur.first = c;
    else if (kind === "lastname") cur.last = c;
    comPairs.set(n, cur);
  }
  for (const [n, p] of [...comPairs.entries()]) {
    if (p.first < 0 && p.last < 0) comPairs.delete(n);
  }

  return {
    filenameCol,
    labelcodeIdx,
    tracktitleIdx,
    isrcIdx,
    cdtitleIdx,
    composerIdx,
    comPairs,
  };
}

function buildArtistFromCom(map: WcpmHeaderMap, row: unknown[]): string {
  const ns = [...map.comPairs.keys()].sort((a, b) => a - b);
  const parts: string[] = [];
  for (const n of ns) {
    const p = map.comPairs.get(n)!;
    const fn = p.first >= 0 ? cellStr(row[p.first]) : "";
    const ln = p.last >= 0 ? cellStr(row[p.last]) : "";
    const one = [fn, ln].filter(Boolean).join(" ").trim();
    if (one) parts.push(one);
  }
  return parts.join("; ");
}

export type WcpmTagPayload = {
  songTitle: string;
  artist: string;
  album: string;
  composer: string;
  isrc: string;
  labelcode: string;
  /** Manuelle Warnung aus Musikverlage-Datenbank (wie Tag-Editor-Checkbox). */
  warnung?: boolean;
};

/** Eine Datenzeile (ohne Kopfzeile) in Tag-Felder übersetzen. */
export function wcpmRowToTagPayload(row: unknown[], map: WcpmHeaderMap): WcpmTagPayload | null {
  const fn = cellStr(row[map.filenameCol]);
  if (!fn) return null;
  const lcRaw =
    map.labelcodeIdx != null && map.labelcodeIdx < row.length
      ? cellStr(row[map.labelcodeIdx])
      : "";
  const labelcode = lcRaw ? labelcodeWithLcPrefix(lcRaw.replace(/^LC\s*/i, "").trim()) : "";
  const songTitle =
    map.tracktitleIdx != null && map.tracktitleIdx < row.length
      ? cellStr(row[map.tracktitleIdx])
      : "";
  const isrc =
    map.isrcIdx != null && map.isrcIdx < row.length ? cellStr(row[map.isrcIdx]) : "";
  const album =
    map.cdtitleIdx != null && map.cdtitleIdx < row.length ? cellStr(row[map.cdtitleIdx]) : "";
  const composer =
    map.composerIdx != null && map.composerIdx < row.length
      ? cellStr(row[map.composerIdx])
      : "";
  const artist = buildArtistFromCom(map, row);
  return { songTitle, artist, album, composer, isrc, labelcode };
}

/**
 * Sucht die erste Zeile, deren Dateiname (Spalte 1) zum gleichen Stamm wie `fileName` pascht
 * (.mp3-/.wav-Endung wird ignoriert).
 */
export function findWcpmRowByStem(
  rows: unknown[][],
  map: WcpmHeaderMap,
  fileNameOrPath: string
): { rowIndex: number; row: unknown[] } | null {
  const want = wcpmFilenameStem(fileNameOrPath);
  const wantMatchKey = wcpmFilenameStemMatchKey(fileNameOrPath);
  const wantAlnum = wcpmFilenameStemAlnumKey(fileNameOrPath);
  const alnumActive = wantAlnum.length >= 8;
  if (!want) return null;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!Array.isArray(row) || row.length === 0) continue;
    const cell = cellStr(row[map.filenameCol]);
    if (!cell) continue;
    const stem = wcpmFilenameStem(cell);
    if (stem === want) {
      return { rowIndex: r, row };
    }
    if (wantMatchKey && wcpmFilenameStemMatchKey(cell) === wantMatchKey) {
      return { rowIndex: r, row };
    }
    if (alnumActive && wcpmFilenameStemAlnumKey(cell) === wantAlnum) {
      return { rowIndex: r, row };
    }
  }
  return null;
}

