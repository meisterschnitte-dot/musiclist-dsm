import type { AudioTags } from "../audio/audioTags";
import type { PlaylistEntry } from "../edl/types";
import { DEFAULT_FPS, framesToTimecode, timecodeToFrames } from "../edl/timecode";
import * as XLSX from "xlsx";

/**
 * Früher: feste erste Datenzeile (Excel 8). Jetzt: alle Zeilen mit ID in Spalte A
 * (üblicherweise laufende Nummer ab 1).
 */
export const GEMA_XLS_FIRST_DATA_ROW = 8;

export function isGemaXlsFileName(name: string): boolean {
  const l = name.toLowerCase();
  return l.endsWith(".xls") || l.endsWith(".xlsx");
}

function cellStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") {
    if (Number.isFinite(v) && Math.abs(v) > 1e9) {
      // Excel-Datum/Zeit manchmal als Zahl — hier nicht für Timecode erwartet
      return String(v);
    }
    return String(v);
  }
  return String(v).trim();
}

/**
 * GEMA/XLS oft ohne Leerzeichen (`LC03098`) — einheitlich mit App-Darstellung `LC 03098`.
 */
function normalizeGemaLabelcodeFromXls(raw: string): string {
  const t = raw.trim();
  if (!t) return t;
  const m = /^lc\s*(\d+)$/i.exec(t);
  if (m) return `LC ${m[1]}`;
  return t;
}

function tryTcFrames(tcRaw: string): number | null {
  const tc = cellStr(tcRaw).trim();
  if (!/^\d{2}:\d{2}:\d{2}:\d{2}$/.test(tc)) return null;
  try {
    return timecodeToFrames(tc, DEFAULT_FPS);
  } catch {
    return null;
  }
}

type GemaColumnKey =
  | "id"
  | "songTitle"
  | "artist"
  | "album"
  | "year"
  | "comment"
  | "isrc"
  | "composer"
  | "labelcode"
  | "label"
  | "hersteller"
  | "gvlRechte"
  | "tcIn"
  | "tcOut";

type GemaSchema = Partial<Record<GemaColumnKey, number>>;

function normalizeHeaderToken(raw: unknown): string {
  return cellStr(raw)
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[-_./]/g, "");
}

function detectSchemaFromHeaderRow(row: string[]): GemaSchema | null {
  const tokens = row.map((c) => normalizeHeaderToken(c));
  const schema: GemaSchema = {};
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] ?? "";
    if (!t) continue;
    if (["#", "id", "nr", "nr.", "no", "nummer", "lfd", "position", "pos"].includes(t)) schema.id = i;
    else if (["tcin", "tcin:", "in", "timecodein"].includes(t)) schema.tcIn = i;
    else if (["tcout", "tcout:", "out", "timecodeout"].includes(t)) schema.tcOut = i;
    else if (["songtitel", "titel", "titelquelle"].includes(t)) schema.songTitle = i;
    else if (["interpret", "artist"].includes(t)) schema.artist = i;
    else if (["albumtitel", "album"].includes(t)) schema.album = i;
    else if (["komponist", "composer"].includes(t)) schema.composer = i;
    else if (["jahr", "year"].includes(t)) schema.year = i;
    else if (["kommentar", "comment"].includes(t)) schema.comment = i;
    else if (["isrc", "iscr"].includes(t)) schema.isrc = i;
    else if (["labelcode", "lc"].includes(t)) schema.labelcode = i;
    else if (["label"].includes(t)) schema.label = i;
    else if (["hersteller"].includes(t)) schema.hersteller = i;
    else if (["rechteruckruf", "rechterückruf", "gvlrechte"].includes(t)) schema.gvlRechte = i;
  }
  const hasId = typeof schema.id === "number";
  const hasTc = typeof schema.tcIn === "number" && typeof schema.tcOut === "number";
  const hasTitleOrArtist = typeof schema.songTitle === "number" || typeof schema.artist === "number";
  return hasId && hasTc && hasTitleOrArtist ? schema : null;
}

function cellAt(row: string[], schema: GemaSchema | null, key: GemaColumnKey, fallback: number): string {
  const idx = schema?.[key];
  const val = typeof idx === "number" ? row[idx] : row[fallback];
  return cellStr(val ?? "");
}

function buildTags(row: string[], schema: GemaSchema | null): AudioTags {
  const tags: AudioTags = {};
  const set = (k: keyof AudioTags, key: GemaColumnKey, fallback: number) => {
    const t = cellAt(row, schema, key, fallback).trim();
    if (t) (tags as Record<string, string>)[k] = t;
  };
  set("songTitle", "songTitle", 1);
  set("artist", "artist", 2);
  set("album", "album", 3);
  set("year", "year", 4);
  set("comment", "comment", 5);
  set("isrc", "isrc", 6);
  set("composer", "composer", 7);
  set("label", "label", 8);
  const lc = normalizeGemaLabelcodeFromXls(cellAt(row, schema, "labelcode", 9));
  if (lc) tags.labelcode = lc;
  set("hersteller", "hersteller", 10);
  set("gvlRechte", "gvlRechte", 11);
  return tags;
}

function rowLooksEmpty(row: string[], schema: GemaSchema | null): boolean {
  const id = cellAt(row, schema, "id", 0);
  const title = cellAt(row, schema, "songTitle", 1);
  const artist = cellAt(row, schema, "artist", 2);
  return !id && !title && !artist;
}

/** Erkennt typische Kopfzeilen in Spalte A (kein Listeneintrag). */
function firstColumnLooksLikeTableHeader(raw: string): boolean {
  const t = raw.trim().toLowerCase();
  if (!t) return true;
  const headers = [
    "id",
    "nr",
    "nr.",
    "no",
    "no.",
    "nummer",
    "lfd",
    "lfd.",
    "#",
    "pos",
    "position",
    "pos.",
  ];
  if (headers.includes(t)) return true;
  if (/^(nr|lfd|pos)\.?$/i.test(t)) return true;
  return false;
}

/** Metazeilen aus dem Musiclist-XLSX-Export (kein Track-Datensatz). */
function isMusiclistExportMetaRow(row: string[]): boolean {
  const a = cellStr(row[0] ?? "").trim().toLowerCase();
  if (!a) return false;
  return a === "titel:" || a === "erstellt am:";
}

/**
 * Tabellenzeile importieren: Spalte A enthält eine ID (in der Regel 1, 2, 3 …).
 * Reine Ziffernfolge ab 1; andere nicht leere IDs (z. B. alphanumerisch) sind erlaubt,
 * solange es keine offensichtliche Kopfzeile ist.
 */
function firstColumnHasImportId(raw: unknown): boolean {
  const s = cellStr(raw).trim();
  if (!s) return false;
  if (firstColumnLooksLikeTableHeader(s)) return false;
  const digitsOnly = /^\d+$/.test(s);
  if (digitsOnly) {
    const n = parseInt(s, 10);
    return Number.isFinite(n) && n >= 1;
  }
  return true;
}

/**
 * Echte Musikzeile: mindestens Titel oder Interpret, oder gültiges TC-In/Out (sonst nur
 * Ziffern in Spalte A o. Ä. — wird nicht als Track importiert).
 */
function rowHasTrackContent(row: string[], schema: GemaSchema | null): boolean {
  const title = cellAt(row, schema, "songTitle", 1).trim();
  if (title) return true;
  const artist = cellAt(row, schema, "artist", 2).trim();
  if (artist) return true;
  const tcIn = tryTcFrames(cellAt(row, schema, "tcIn", 13));
  const tcOut = tryTcFrames(cellAt(row, schema, "tcOut", 14));
  return tcIn !== null && tcOut !== null && tcOut > tcIn;
}

/** Fußzeile unter der GEMA-Tabelle — darf nicht als Listeneintrag importiert werden. */
function isGemaListFooterDisclaimerRow(row: string[]): boolean {
  const joined = row.join(" ").toLowerCase();
  if (joined.includes("gvl.de/rechterueckruftabelle")) return true;
  if (joined.includes("rechterueckruftabelle") && joined.includes("gvl")) return true;
  return false;
}

export type ParseGemaXlsResult = {
  playlist: PlaylistEntry[];
  tagEntries: { id: string; tags: AudioTags }[];
};

/**
 * Liest eine GEMA-Listen-XLS: festes Spaltenlayout wie bisher; Datenzeilen haben eine ID
 * in Spalte A (üblicherweise ab 1) **und** mindestens Titel, Interpret oder gültige Timecodes
 * — reine Ziffern in Spalte A ohne Inhalt werden ignoriert.
 */
export function parseGemaXls(buffer: ArrayBuffer): ParseGemaXlsResult {
  const wb = XLSX.read(buffer, { type: "array", cellDates: false });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("Die Excel-Datei enthält kein Arbeitsblatt.");

  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    raw: false,
  }) as unknown[][];

  const playlist: PlaylistEntry[] = [];
  const tagEntries: { id: string; tags: AudioTags }[] = [];
  let schema: GemaSchema | null = null;

  let seq = 0;
  for (let i = 0; i < rows.length; i++) {
    const rawRow = rows[i];
    if (!rawRow || !rawRow.length) continue;
    const row = rawRow.map((c) => cellStr(c));
    if (!schema) {
      schema = detectSchemaFromHeaderRow(row);
      if (schema) continue;
    }
    if (isGemaListFooterDisclaimerRow(row)) break;
    if (isMusiclistExportMetaRow(row)) continue;
    if (!firstColumnHasImportId(cellAt(row, schema, "id", 0))) continue;
    if (rowLooksEmpty(row, schema)) continue;
    if (!rowHasTrackContent(row, schema)) continue;

    const titleCol = cellAt(row, schema, "songTitle", 1).trim();
    const title = titleCol || "(ohne Titel)";
    const tcIn = tryTcFrames(cellAt(row, schema, "tcIn", 13));
    const tcOut = tryTcFrames(cellAt(row, schema, "tcOut", 14));
    let recInFrames: number;
    let recOutFrames: number;
    if (tcIn !== null && tcOut !== null && tcOut > tcIn) {
      recInFrames = tcIn;
      recOutFrames = tcOut;
    } else {
      recInFrames = seq * DEFAULT_FPS * 60;
      recOutFrames = recInFrames + DEFAULT_FPS * 5;
      seq += 1;
    }

    const recIn = framesToTimecode(recInFrames, DEFAULT_FPS);
    const recOut = framesToTimecode(recOutFrames, DEFAULT_FPS);
    const sourceKey = `${cellAt(row, schema, "id", 0).toLowerCase()}-${title.toLowerCase().slice(0, 48)}`;
    const id = `gema-${i}-${recInFrames}-${recOutFrames}-${sourceKey.replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`;

    const tags = buildTags(row, schema);

    playlist.push({
      id,
      title,
      track: "—",
      recIn,
      recOut,
      recInFrames,
      recOutFrames,
      sourceKey,
    });
    tagEntries.push({ id, tags });
  }

  if (playlist.length === 0) {
    throw new Error(
      "Keine Listeneinträge gefunden. Erwartet wird: ID in Spalte A (üblicherweise 1, 2, 3 …) plus mindestens Titel (Spalte B), Interpret (Spalte C) oder gültige Timecodes — und das bekannte GEMA-Spaltenlayout."
    );
  }

  return { playlist, tagEntries };
}
