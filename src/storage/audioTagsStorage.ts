import { mergeAudioTags, type AudioTags } from "../audio/audioTags";
import type { PlaylistEntry } from "../edl/types";
import { basenamePath } from "../tracks/sanitizeFilename";
import { openSettingsDb, STORE_SETTINGS } from "./idb";

/** Geteilt: Tags zu MP3-Dateinamen (`f:`). */
const LS_FILES = "musiclist-audio-tags-files-v1";
const LS_FILES_LEGACY = "easy-gema-audio-tags-files-v1";
/** Pro Nutzer: Tags zu Playlist-Zeilen (`p:`). */
const lsPlaylistKey = (userId: string) => `musiclist-audio-tags-pl-${userId}`;
const lsPlaylistKeyLegacy = (userId: string) => `easy-gema-audio-tags-pl-${userId}`;

const LS_LEGACY = "easy-gema-audio-tags-v1";
const KEY_TAGS_IDB_FILES = "audioTagsFilesBackupV1";
const idbPlaylistKey = (userId: string) => `audioTagsPlaylistBackupV1:${userId}`;
const KEY_TAGS_IDB_LEGACY = "audioTagsBackupV1";

export type TagStore = Record<string, AudioTags>;

function splitTags(store: TagStore): { files: TagStore; playlist: TagStore } {
  const files: TagStore = {};
  const playlist: TagStore = {};
  for (const [k, v] of Object.entries(store)) {
    if (k.startsWith("p:")) playlist[k] = v;
    else files[k] = v;
  }
  return { files, playlist };
}

function mergeTags(files: TagStore, playlist: TagStore): TagStore {
  return { ...files, ...playlist };
}

function parseLs(raw: string | null): TagStore {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as TagStore;
  } catch {
    return {};
  }
}

/** Einmalig: alte LocalStorage-Schlüssel des Vorgängernamens → musiclist-*. */
function migrateLegacyBrandSplitKeys(userId: string): void {
  try {
    if (!localStorage.getItem(LS_FILES)) {
      const oldF = localStorage.getItem(LS_FILES_LEGACY);
      if (oldF) {
        localStorage.setItem(LS_FILES, oldF);
        localStorage.removeItem(LS_FILES_LEGACY);
      }
    }
    const plKey = lsPlaylistKey(userId);
    if (!localStorage.getItem(plKey)) {
      const oldP = localStorage.getItem(lsPlaylistKeyLegacy(userId));
      if (oldP) {
        localStorage.setItem(plKey, oldP);
        localStorage.removeItem(lsPlaylistKeyLegacy(userId));
      }
    }
  } catch {
    /* ignore */
  }
}

function migrateLegacyLocalStorage(userId: string): void {
  try {
    const raw = localStorage.getItem(LS_LEGACY);
    if (!raw) return;
    const legacy = parseLs(raw);
    if (Object.keys(legacy).length === 0) {
      localStorage.removeItem(LS_LEGACY);
      return;
    }
    const { files, playlist } = splitTags(legacy);
    const existingFiles = parseLs(localStorage.getItem(LS_FILES));
    const existingPl = parseLs(localStorage.getItem(lsPlaylistKey(userId)));
    localStorage.setItem(LS_FILES, JSON.stringify({ ...existingFiles, ...files }));
    localStorage.setItem(lsPlaylistKey(userId), JSON.stringify({ ...existingPl, ...playlist }));
    localStorage.removeItem(LS_LEGACY);
  } catch {
    /* ignore */
  }
}

export function loadTagStore(userId: string): TagStore {
  migrateLegacyBrandSplitKeys(userId);
  migrateLegacyLocalStorage(userId);
  const files = parseLs(localStorage.getItem(LS_FILES));
  const playlist = parseLs(localStorage.getItem(lsPlaylistKey(userId)));
  return mergeTags(files, playlist);
}

async function saveFileTagsToIdb(store: TagStore): Promise<void> {
  try {
    const db = await openSettingsDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_SETTINGS, "readwrite");
      tx.objectStore(STORE_SETTINGS).put(store, KEY_TAGS_IDB_FILES);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}

async function savePlaylistTagsToIdb(store: TagStore, userId: string): Promise<void> {
  try {
    const db = await openSettingsDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_SETTINGS, "readwrite");
      tx.objectStore(STORE_SETTINGS).put(store, idbPlaylistKey(userId));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}

async function migrateLegacyIdb(userId: string): Promise<TagStore | null> {
  try {
    const db = await openSettingsDb();
    const legacy = await new Promise<TagStore | null>((resolve, reject) => {
      const tx = db.transaction(STORE_SETTINGS, "readonly");
      const req = tx.objectStore(STORE_SETTINGS).get(KEY_TAGS_IDB_LEGACY);
      req.onsuccess = () => {
        const r = req.result as unknown;
        if (!r || typeof r !== "object") resolve(null);
        else resolve(r as TagStore);
      };
      req.onerror = () => reject(req.error);
    });
    if (!legacy || Object.keys(legacy).length === 0) return null;
    const { files, playlist } = splitTags(legacy);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_SETTINGS, "readwrite");
      const s = tx.objectStore(STORE_SETTINGS);
      s.delete(KEY_TAGS_IDB_LEGACY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    const fLs = parseLs(localStorage.getItem(LS_FILES));
    const pLs = parseLs(localStorage.getItem(lsPlaylistKey(userId)));
    localStorage.setItem(LS_FILES, JSON.stringify({ ...fLs, ...files }));
    localStorage.setItem(lsPlaylistKey(userId), JSON.stringify({ ...pLs, ...playlist }));
    return mergeTags({ ...fLs, ...files }, { ...pLs, ...playlist });
  } catch {
    return null;
  }
}

/** Wenn localStorage leer: Spiegel aus IndexedDB (Datei- + Playlist-Teil). */
export async function loadTagStoreFromIdb(userId: string): Promise<TagStore | null> {
  try {
    const migrated = await migrateLegacyIdb(userId);
    if (migrated) return migrated;

    const db = await openSettingsDb();
    const [filesRaw, plRaw] = await Promise.all([
      new Promise<TagStore | null>((resolve, reject) => {
        const tx = db.transaction(STORE_SETTINGS, "readonly");
        const req = tx.objectStore(STORE_SETTINGS).get(KEY_TAGS_IDB_FILES);
        req.onsuccess = () => {
          const r = req.result as unknown;
          if (!r || typeof r !== "object") resolve(null);
          else resolve(r as TagStore);
        };
        req.onerror = () => reject(req.error);
      }),
      new Promise<TagStore | null>((resolve, reject) => {
        const tx = db.transaction(STORE_SETTINGS, "readonly");
        const req = tx.objectStore(STORE_SETTINGS).get(idbPlaylistKey(userId));
        req.onsuccess = () => {
          const r = req.result as unknown;
          if (!r || typeof r !== "object") resolve(null);
          else resolve(r as TagStore);
        };
        req.onerror = () => reject(req.error);
      }),
    ]);
    if ((!filesRaw || Object.keys(filesRaw).length === 0) && (!plRaw || Object.keys(plRaw).length === 0)) {
      return null;
    }
    return mergeTags(filesRaw ?? {}, plRaw ?? {});
  } catch {
    return null;
  }
}

export function saveTagStore(store: TagStore, userId: string): void {
  const { files, playlist } = splitTags(store);
  try {
    localStorage.setItem(LS_FILES, JSON.stringify(files));
    localStorage.setItem(lsPlaylistKey(userId), JSON.stringify(playlist));
  } catch {
    /* Quota oder private mode */
  }
  void saveFileTagsToIdb(files);
  void savePlaylistTagsToIdb(playlist, userId);
}

export function playlistTagKey(entryId: string): string {
  return `p:${entryId}`;
}

export function fileTagKey(fileName: string): string {
  return `f:${fileName.toLowerCase()}`;
}

/**
 * Tag-Overlay für eine Playlist-Zeile: bei verknüpfter MP3 `f:` + Legacy `p:` (Migration);
 * ohne Verknüpfung nur `p:`.
 */
export function playlistRowTagOverlay(row: PlaylistEntry, tagStore: TagStore): AudioTags {
  const pk = playlistTagKey(row.id);
  const linked = row.linkedTrackFileName?.trim();
  if (linked) {
    return mergeAudioTags(tagStore[pk] ?? {}, tagStore[fileTagKey(linked)] ?? {});
  }
  return tagStore[pk] ?? {};
}

/** Speicher-Schlüssel für neue Tag-Overlays: bei Link `f:` (geteilt mit Musikdatenbank), sonst `p:`. */
export function playlistEntryTagStoreKey(row: PlaylistEntry): string {
  const linked = row.linkedTrackFileName?.trim();
  if (linked) return fileTagKey(linked);
  return playlistTagKey(row.id);
}

function normTagPath(s: string): string {
  return s.replace(/\\/g, "/").trim().toLowerCase();
}

/** Normalisierte Pfade, die noch in der Playlist verknüpft sind (Offline-Zeilen nach DB-Löschen). */
function playlistNormLinkedPaths(playlist: PlaylistEntry[] | null | undefined): Set<string> {
  const s = new Set<string>();
  for (const row of playlist ?? []) {
    const linked = row.linkedTrackFileName?.trim();
    if (linked) s.add(normTagPath(linked));
  }
  return s;
}

function playlistReferencesBasename(playlist: PlaylistEntry[] | null | undefined, baseLower: string): boolean {
  for (const row of playlist ?? []) {
    const linked = row.linkedTrackFileName?.trim();
    if (!linked) continue;
    if (basenamePath(linked).toLowerCase() === baseLower) return true;
  }
  return false;
}

/**
 * Schlüssel aus dem Tag-Store entfernen, die zu gelöschten MP3-Pfaden gehören:
 * — `f:` mit vollem relativen Pfad (und ggf. nur Dateiname, wenn kein anderer DB-Eintrag denselben Basename hat).
 * Pfade, die noch in der Playlist verknüpft sind, bleiben erhalten (Offline-Zeilen: Tags + weiße Markierung).
 */
export function collectTagStoreKeysForRemovedMusicPaths(
  removedRelativePaths: string[],
  playlist: PlaylistEntry[] | null | undefined,
  /** Aktuelle Musikdatenbank nach dem Löschen; bei `null` werden keine reinen Basename-`f:`-Schlüssel gelöscht. */
  musicDbPathsAfterRemoval: string[] | null
): string[] {
  const keys = new Set<string>();
  const playlistLinked = playlistNormLinkedPaths(playlist);

  for (const p of removedRelativePaths) {
    const np = normTagPath(p);
    if (playlistLinked.has(np)) continue;
    keys.add(fileTagKey(p));
    if (musicDbPathsAfterRemoval) {
      const b = basenamePath(p);
      const bl = b.toLowerCase();
      if (playlistReferencesBasename(playlist, bl)) continue;
      const otherStillHasBasename = musicDbPathsAfterRemoval.some(
        (x) => basenamePath(x).toLowerCase() === bl
      );
      if (!otherStillHasBasename) {
        keys.add(fileTagKey(b));
      }
    }
  }

  return [...keys];
}
