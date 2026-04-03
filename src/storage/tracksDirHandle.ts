import { openSettingsDb, STORE_SETTINGS } from "./idb";

/** Gemeinsamer MP3-Speicherort für alle Nutzer (Musikdatenbank). */
const KEY_TRACKS = "tracksDirHandle";

export async function saveTracksDirHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openSettingsDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SETTINGS, "readwrite");
    tx.objectStore(STORE_SETTINGS).put(handle, KEY_TRACKS);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadTracksDirHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openSettingsDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SETTINGS, "readonly");
      const req = tx.objectStore(STORE_SETTINGS).get(KEY_TRACKS);
      req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

/**
 * Nur Status abfragen — **kein** Permission-Dialog.
 * Wenn `true`, sind readwrite-Operationen ohne weiteres Nachfragen möglich (typisch nach einmaliger Zustimmung, gleiche Origin).
 */
export async function hasWritableAccess(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const opts = { mode: "readwrite" as const };
  try {
    return (await handle.queryPermission(opts)) === "granted";
  } catch {
    return false;
  }
}

/**
 * Schreibzugriff sicherstellen — nur bei **Nutzeraktion** aufrufen (Klick o. ä.), da sonst
 * `requestPermission` einen Browser-Dialog zeigen kann.
 */
export async function ensureWritableDir(
  handle: FileSystemDirectoryHandle
): Promise<boolean> {
  const opts = { mode: "readwrite" as const };
  try {
    if ((await handle.queryPermission(opts)) === "granted") return true;
    if ((await handle.requestPermission(opts)) === "granted") return true;
  } catch {
    return false;
  }
  return false;
}
