import {
  AUDIO_TAG_TABLE_COLUMN_KEYS,
  tagCellText,
  type AudioTags,
} from "./audio/audioTags";
import type { PlaylistEntry } from "./edl/types";
import { playlistDurationTimecode } from "./edl/timecode";
import type { EdlTableColumnId } from "./edlTableLayout";
import type { Mp3TableColumnId } from "./mp3TableLayout";

export function hasActiveColumnFilters(filters: string[]): boolean {
  return filters.some((f) => f.trim().length > 0);
}

export function hasActiveColumnFiltersRecord(filters: Record<string, string>): boolean {
  return Object.values(filters).some((f) => f.trim().length > 0);
}

/** Alle Filter leer → jede Zeile sichtbar; sonst AND über alle nicht leeren Filter (Teilstring, ohne Groß/Klein). */
export function matchesColumnFilters(cellValues: string[], filters: string[]): boolean {
  for (let i = 0; i < filters.length; i++) {
    const raw = filters[i];
    if (!raw?.trim()) continue;
    const needle = raw.trim().toLowerCase();
    const hay = (cellValues[i] ?? "").toLowerCase();
    if (!hay.includes(needle)) return false;
  }
  return true;
}

export function buildEdlRowCellsMap(
  row: PlaylistEntry,
  rowIndex: number,
  merged: AudioTags
): Record<EdlTableColumnId, string> {
  const o = {} as Record<EdlTableColumnId, string>;
  o.num = String(rowIndex + 1);
  o.track = row.track;
  o.tcIn = row.recIn;
  o.tcOut = row.recOut;
  o.duration = playlistDurationTimecode(row.recInFrames, row.recOutFrames);
  o.title = row.linkedTrackFileName ?? row.title;
  for (const k of AUDIO_TAG_TABLE_COLUMN_KEYS) {
    o[k] = tagCellText(merged, k);
  }
  return o;
}

export function buildEdlRowCellStrings(
  row: PlaylistEntry,
  rowIndex: number,
  merged: AudioTags
): string[] {
  const m = buildEdlRowCellsMap(row, rowIndex, merged);
  return [
    m.num,
    m.track,
    m.tcIn,
    m.tcOut,
    m.duration,
    m.title,
    ...AUDIO_TAG_TABLE_COLUMN_KEYS.map((k) => m[k]),
  ];
}

/** Einheitliche Katalognummer in der Musikdatenbank, z. B. `#000000042`. */
export function formatMusicDbTrackNumber(oneBasedIndex: number): string {
  const n = Math.max(1, Math.floor(oneBasedIndex));
  return `#${String(n).padStart(9, "0")}`;
}

/** Anzeige für Erstell-/Bearbeitungsdatum (Musikdatenbank); leer → Filter „—“. */
export function formatMusicDbTimestamp(iso: string | undefined): string {
  if (!iso?.trim()) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** Zelltexte je Spalten-ID (Filter, Sichtbarkeit, Reihenfolge). */
export function buildMp3RowCellsMap(
  fileName: string,
  merged: AudioTags,
  globalIndexOneBased: number,
  meta?: { createdAt?: string; updatedAt?: string } | null
): Record<Mp3TableColumnId, string> {
  const o = {} as Record<Mp3TableColumnId, string>;
  o.num = formatMusicDbTrackNumber(globalIndexOneBased);
  o.filename = fileName;
  o.created = formatMusicDbTimestamp(meta?.createdAt);
  o.edited = formatMusicDbTimestamp(meta?.updatedAt);
  for (const k of AUDIO_TAG_TABLE_COLUMN_KEYS) {
    o[k] = tagCellText(merged, k);
  }
  return o;
}

export function buildMp3RowCellStrings(
  fileName: string,
  merged: AudioTags,
  globalIndexOneBased: number,
  meta?: { createdAt?: string; updatedAt?: string } | null
): string[] {
  const m = buildMp3RowCellsMap(fileName, merged, globalIndexOneBased, meta);
  return [
    m.num,
    m.filename,
    m.created,
    m.edited,
    ...AUDIO_TAG_TABLE_COLUMN_KEYS.map((k) => m[k]),
  ];
}
