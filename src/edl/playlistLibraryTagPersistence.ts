import {
  defaultTagsFromPlaylistTitle,
  hasAnyAudioTagValue,
  mergeAudioTags,
  mergeWarnungForDisplay,
  overlayFromForm,
  type AudioTags,
} from "../audio/audioTags";
import {
  fileTagKey,
  playlistRowTagOverlay,
  playlistTagKey,
  type TagStore,
} from "../storage/audioTagsStorage";
import type { PlaylistEntry } from "./types";

/** Anzeige-Tags einer Playlist-Zeile (wie in der Tabelle). */
export function mergedTagsForPlaylistRow(row: PlaylistEntry, tagStore: TagStore): AudioTags {
  const base = defaultTagsFromPlaylistTitle(row.linkedTrackFileName ?? row.title);
  return mergeWarnungForDisplay(mergeAudioTags(base, playlistRowTagOverlay(row, tagStore)));
}

/** `tagsByRowId` für .list-Dateien (vollständige Anzeige-Tags je Zeilen-ID). */
export function buildTagsByRowIdForLibrarySave(
  playlist: PlaylistEntry[],
  tagStore: TagStore
): Record<string, AudioTags> {
  const out: Record<string, AudioTags> = {};
  for (const row of playlist) {
    const merged = mergedTagsForPlaylistRow(row, tagStore);
    if (!hasAnyAudioTagValue(merged) && merged.warnung !== true) continue;
    out[row.id] = merged;
  }
  return out;
}

function fileTagStoreHasData(store: TagStore, linked: string): boolean {
  const fk = fileTagKey(linked);
  const tags = store[fk];
  return !!tags && hasAnyAudioTagValue(tags);
}

/**
 * Übernimmt gespeicherte Tags aus einer .list-Datei in den Tag-Store.
 * Verknüpfte MP3-Zeilen: nur `f:` (geteilt mit Musikdatenbank), kein `p:` — verhindert,
 * dass veraltete XLS-/Listen-Tags nach einem Reload die aktuellen MP3-Tags überdecken.
 */
export function applyTagsByRowIdToTagStore(
  playlist: PlaylistEntry[],
  tagsByRowId: Record<string, AudioTags>,
  prev: TagStore
): TagStore {
  const next = { ...prev };
  const rowById = new Map(playlist.map((r) => [r.id, r]));

  for (const row of playlist) {
    if (row.linkedTrackFileName?.trim()) {
      delete next[playlistTagKey(row.id)];
    }
  }

  for (const [rowId, stored] of Object.entries(tagsByRowId)) {
    const row = rowById.get(rowId);
    if (!row) continue;
    const base = defaultTagsFromPlaylistTitle(row.linkedTrackFileName ?? row.title);
    const overlay = overlayFromForm(base, stored);
    const linked = row.linkedTrackFileName?.trim();
    if (linked) {
      if (!fileTagStoreHasData(next, linked)) {
        const fk = fileTagKey(linked);
        if (Object.keys(overlay).length === 0) delete next[fk];
        else next[fk] = overlay;
      }
      continue;
    }
    if (Object.keys(overlay).length === 0) delete next[playlistTagKey(rowId)];
    else next[playlistTagKey(rowId)] = overlay;
  }

  return next;
}
