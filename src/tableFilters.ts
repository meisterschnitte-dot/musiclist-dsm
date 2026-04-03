import {
  AUDIO_TAG_TABLE_COLUMN_KEYS,
  tagCellText,
  type AudioTags,
} from "./audio/audioTags";
import type { PlaylistEntry } from "./edl/types";
import { playlistDurationTimecode } from "./edl/timecode";

export function hasActiveColumnFilters(filters: string[]): boolean {
  return filters.some((f) => f.trim().length > 0);
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

export function buildEdlRowCellStrings(
  row: PlaylistEntry,
  rowIndex: number,
  merged: AudioTags
): string[] {
  return [
    String(rowIndex + 1),
    row.track,
    row.recIn,
    row.recOut,
    playlistDurationTimecode(row.recInFrames, row.recOutFrames),
    row.linkedTrackFileName ?? row.title,
    ...AUDIO_TAG_TABLE_COLUMN_KEYS.map((k) => tagCellText(merged, k)),
  ];
}

/** Einheitliche Katalognummer in der Musikdatenbank, z. B. `#000000042`. */
export function formatMusicDbTrackNumber(oneBasedIndex: number): string {
  const n = Math.max(1, Math.floor(oneBasedIndex));
  return `#${String(n).padStart(9, "0")}`;
}

export function buildMp3RowCellStrings(
  fileName: string,
  merged: AudioTags,
  globalIndexOneBased: number
): string[] {
  return [
    formatMusicDbTrackNumber(globalIndexOneBased),
    fileName,
    ...AUDIO_TAG_TABLE_COLUMN_KEYS.map((k) => tagCellText(merged, k)),
  ];
}
