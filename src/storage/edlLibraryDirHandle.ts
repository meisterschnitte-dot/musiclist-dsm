import { openSettingsDb, STORE_SETTINGS } from "./idb";

const KEY_LEGACY = "edlLibraryDirHandle";

function keyFor(userId: string): string {
  return `edlLibraryDirHandle:${userId}`;
}

async function migrateLegacyToUser(db: IDBDatabase, userId: string): Promise<void> {
  const h = await new Promise<FileSystemDirectoryHandle | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE_SETTINGS, "readonly");
    const req = tx.objectStore(STORE_SETTINGS).get(KEY_LEGACY);
    req.onsuccess = () => resolve(req.result as FileSystemDirectoryHandle | undefined);
    req.onerror = () => reject(req.error);
  });
  if (!h) return;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_SETTINGS, "readwrite");
    const store = tx.objectStore(STORE_SETTINGS);
    store.put(h, keyFor(userId));
    store.delete(KEY_LEGACY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveEdlLibraryDirHandle(
  handle: FileSystemDirectoryHandle,
  userId: string
): Promise<void> {
  const db = await openSettingsDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SETTINGS, "readwrite");
    tx.objectStore(STORE_SETTINGS).put(handle, keyFor(userId));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadEdlLibraryDirHandle(userId: string): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openSettingsDb();
    let h = await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
      const tx = db.transaction(STORE_SETTINGS, "readonly");
      const req = tx.objectStore(STORE_SETTINGS).get(keyFor(userId));
      req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
    if (!h) {
      await migrateLegacyToUser(db, userId);
      h = await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
        const tx = db.transaction(STORE_SETTINGS, "readonly");
        const req = tx.objectStore(STORE_SETTINGS).get(keyFor(userId));
        req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle | undefined) ?? null);
        req.onerror = () => reject(req.error);
      });
    }
    return h;
  } catch {
    return null;
  }
}
