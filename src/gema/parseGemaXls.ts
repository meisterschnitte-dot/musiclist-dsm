import type { AudioTags } from "../audio/audioTags";
import type { PlaylistEntry } from "../edl/types";
import { DEFAULT_FPS, framesToTimecode, timecodeToFrames } from "../edl/timecode";
import * as XLSX from "xlsx";

/** Erste Datenzeile in GEMA-Export-XLS (1-basiert, wie in Excel). */
export const GEMA_XLS_FIRST_DATA_ROW = 8;

/** 0-basierte Zeilennummer der ersten Datenzeile im Sheet-Array. */
const FIRST_DATA_ROW_INDEX = GEMA_XLS_FIRST_DATA_ROW - 1;

export function isGemaXlsFileName(name: string): boolean {
  return name.toLowerCase().endsWith(".xls");
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

function buildTags(row: string[]): AudioTags {
  const tags: AudioTags = {};
  const set = (k: keyof AudioTags, col: number) => {
    const t = cellStr(row[col] ?? "").trim();
    if (t) (tags as Record<string, string>)[k] = t;
  };
  set("songTitle", 1);
  set("artist", 2);
  set("album", 3);
  set("year", 4);
  set("comment", 5);
  set("composer", 7);
  set("label", 8);
  const lc = normalizeGemaLabelcodeFromXls(cellStr(row[9] ?? ""));
  if (lc) tags.labelcode = lc;
  set("hersteller", 10);
  set("gvlRechte", 11);
  return tags;
}

function rowLooksEmpty(row: string[]): boolean {
  const id = cellStr(row[0] ?? "");
  const title = cellStr(row[1] ?? "");
  const artist = cellStr(row[2] ?? "");
  return !id && !title && !artist;
}

export type ParseGemaXlsResult = {
  playlist: PlaylistEntry[];
  tagEntries: { id: string; tags: AudioTags }[];
};

/**
 * Liest eine GEMA-Listen-XLS: festes Layout, erste Datenzeile Excel-Zeile 8.
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

  let seq = 0;
  for (let i = FIRST_DATA_ROW_INDEX; i < rows.length; i++) {
    const rawRow = rows[i];
    if (!rawRow || !rawRow.length) continue;
    const row = rawRow.map((c) => cellStr(c));
    if (rowLooksEmpty(row)) continue;

    const titleCol = cellStr(row[1]).trim();
    const title = titleCol || "(ohne Titel)";
    const tcIn = tryTcFrames(row[13] ?? "");
    const tcOut = tryTcFrames(row[14] ?? "");
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
    const sourceKey = `${cellStr(row[0]).toLowerCase()}-${title.toLowerCase().slice(0, 48)}`;
    const id = `gema-${i}-${recInFrames}-${recOutFrames}-${sourceKey.replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`;

    const tags = buildTags(row);

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
      `Keine Listeneinträge ab Zeile ${GEMA_XLS_FIRST_DATA_ROW} gefunden. Erwartet wird die übliche GEMA-Exportstruktur.`
    );
  }

  return { playlist, tagEntries };
}
