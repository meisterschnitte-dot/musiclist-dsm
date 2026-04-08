import type { PlaylistEntry } from "./types";
import type { AudioTags } from "../audio/audioTags";

/** Gespeicherte Playlist im EDL- & Playlist Browser (kein Roh-EDL mehr). */
export const PLAYLIST_LIBRARY_FILE_EXT = ".list";

/** Ältere Dateien vor Umbenennung auf `.list` */
export const LEGACY_PLAYLIST_LIBRARY_FILE_EXT = ".egpl";

export function isPlaylistLibraryFileName(fileName: string): boolean {
  const l = fileName.toLowerCase();
  return l.endsWith(PLAYLIST_LIBRARY_FILE_EXT) || l.endsWith(LEGACY_PLAYLIST_LIBRARY_FILE_EXT);
}

/** Referenz auf eine Bibliotheksdatei (Mehrfachauswahl / Kontextmenü). */
export type EdlLibraryFileRef = {
  parentSegments: string[];
  fileName: string;
};

export function edlLibraryFileRefKey(ref: EdlLibraryFileRef): string {
  return JSON.stringify({ parentSegments: ref.parentSegments, fileName: ref.fileName });
}

export function parseEdlLibraryFileRefKey(key: string): EdlLibraryFileRef | null {
  try {
    const o = JSON.parse(key) as unknown;
    if (!o || typeof o !== "object") return null;
    const r = o as Record<string, unknown>;
    const segs = r.parentSegments;
    const fn = r.fileName;
    if (!Array.isArray(segs) || !segs.every((x) => typeof x === "string")) return null;
    if (typeof fn !== "string" || !fn.trim()) return null;
    return { parentSegments: segs as string[], fileName: fn };
  } catch {
    return null;
  }
}

/**
 * Dieselbe Playlist im Browser (z. B. `Film.edl` und nach Export `Film.list`;
 * oder `.xls` → `.list` mit gleichem Stamm).
 */
export function sameLibraryPlaylistDocumentName(a: string, b: string): boolean {
  const stem = (fn: string) => {
    const t = fn.trim();
    const l = t.toLowerCase();
    if (l.endsWith(".edl")) return t.slice(0, -4);
    if (l.endsWith(".list")) return t.slice(0, -5);
    if (l.endsWith(".egpl")) return t.slice(0, -5);
    if (l.endsWith(".xls")) return t.slice(0, -4);
    const d = t.lastIndexOf(".");
    return d === -1 ? t : t.slice(0, d);
  };
  return stem(a).toLowerCase() === stem(b).toLowerCase();
}

export type PersistedPlaylistLibraryV1 = {
  v: 1;
  displayTitle: string | null;
  playlist: PlaylistEntry[];
  /** Optionale Tag-Overlays je Zeilen-ID (für Kundenfreigaben ohne lokale Tag-Datenbank). */
  tagsByRowId?: Record<string, AudioTags>;
  /** Zeitpunkt, zu dem die MP3-Verknüpfungen festgeschrieben wurden */
  tracksLinkedAtIso: string;
};

function isPlaylistEntry(x: unknown): x is PlaylistEntry {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.title === "string" &&
    typeof o.track === "string" &&
    typeof o.recIn === "string" &&
    typeof o.recOut === "string" &&
    typeof o.recInFrames === "number" &&
    typeof o.recOutFrames === "number" &&
    typeof o.sourceKey === "string" &&
    (o.linkedTrackFileName === undefined || typeof o.linkedTrackFileName === "string")
  );
}

function normalizeAudioTags(raw: unknown): AudioTags | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const out: AudioTags = {};
  const strKeys: Array<Exclude<keyof AudioTags, "warnung">> = [
    "songTitle",
    "artist",
    "album",
    "year",
    "comment",
    "composer",
    "isrc",
    "labelcode",
    "label",
    "hersteller",
    "gvlRechte",
  ];
  for (const k of strKeys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  if (o.warnung === true) out.warnung = true;
  return Object.keys(out).length > 0 ? out : null;
}

export function parsePlaylistLibraryFile(text: string): PersistedPlaylistLibraryV1 {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new Error("Keine gültige Playlist-Datei (JSON).");
  }
  if (!raw || typeof raw !== "object") throw new Error("Ungültige Playlist-Datei.");
  const o = raw as Record<string, unknown>;
  if (o.v !== 1) throw new Error("Unbekannte Playlist-Version.");
  if (!Array.isArray(o.playlist)) throw new Error("Playlist-Datei enthält keine Liste.");
  const playlist: PlaylistEntry[] = [];
  for (const row of o.playlist) {
    if (!isPlaylistEntry(row)) throw new Error("Ungültiger Listeneintrag in der Playlist-Datei.");
    playlist.push({
      ...row,
      linkedTrackFileName:
        typeof row.linkedTrackFileName === "string" && row.linkedTrackFileName.trim()
          ? row.linkedTrackFileName.trim()
          : undefined,
    });
  }
  if (playlist.length === 0) throw new Error("Die Playlist-Datei ist leer.");
  for (const row of playlist) {
    if (!row.linkedTrackFileName?.trim()) {
      throw new Error(
        "Diese Playlist enthält Zeilen ohne MP3-Verknüpfung. Bitte „Fake-MP3 aus EDL“ erneut ausführen."
      );
    }
  }
  const displayTitle =
    o.displayTitle === null || o.displayTitle === undefined
      ? null
      : typeof o.displayTitle === "string"
        ? o.displayTitle
        : null;
  const tracksLinkedAtIso =
    typeof o.tracksLinkedAtIso === "string" && o.tracksLinkedAtIso.trim()
      ? o.tracksLinkedAtIso.trim()
      : new Date().toISOString();
  let tagsByRowId: Record<string, AudioTags> | undefined;
  if (o.tagsByRowId && typeof o.tagsByRowId === "object") {
    const map = o.tagsByRowId as Record<string, unknown>;
    const next: Record<string, AudioTags> = {};
    for (const [rowId, rawTags] of Object.entries(map)) {
      if (!rowId.trim()) continue;
      const tags = normalizeAudioTags(rawTags);
      if (!tags) continue;
      next[rowId] = tags;
    }
    if (Object.keys(next).length > 0) tagsByRowId = next;
  }
  return { v: 1, displayTitle, playlist, tagsByRowId, tracksLinkedAtIso };
}

export function serializePlaylistLibraryFile(data: PersistedPlaylistLibraryV1): string {
  return `${JSON.stringify(data)}\n`;
}

/** `Film.edl` → `Film.list` */
export function edlFileNameToPlaylistFileName(edlFileName: string): string {
  const lower = edlFileName.toLowerCase();
  if (lower.endsWith(".edl")) {
    return `${edlFileName.slice(0, -4)}${PLAYLIST_LIBRARY_FILE_EXT}`;
  }
  const dot = edlFileName.lastIndexOf(".");
  const base = dot === -1 ? edlFileName : edlFileName.slice(0, dot);
  return `${base}${PLAYLIST_LIBRARY_FILE_EXT}`;
}

/** `Liste.xls` → `Liste.list` (nach Fake-MP3-Export neben der XLS ablegen). */
export function gemaXlsFileNameToPlaylistFileName(xlsFileName: string): string {
  const lower = xlsFileName.toLowerCase();
  if (lower.endsWith(".xls")) {
    return `${xlsFileName.slice(0, -4)}${PLAYLIST_LIBRARY_FILE_EXT}`;
  }
  return edlFileNameToPlaylistFileName(xlsFileName);
}
