import { openSettingsDb, STORE_SETTINGS } from "./idb";

const KEY_LEGACY = "edlLibraryBaseDisplayName";

function keyFor(userId: string): string {
  return `edlLibraryBaseDisplayName:${userId}`;
}

async function migrateLegacyStringToUser(db: IDBDatabase, userId: string): Promise<void> {
  const v = await new Promise<string | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE_SETTINGS, "readonly");
    const req = tx.objectStore(STORE_SETTINGS).get(KEY_LEGACY);
    req.onsuccess = () => resolve(req.result as string | undefined);
    req.onerror = () => reject(req.error);
  });
  if (typeof v !== "string" || !v.trim()) return;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_SETTINGS, "readwrite");
    const store = tx.objectStore(STORE_SETTINGS);
    store.put(v.trim(), keyFor(userId));
    store.delete(KEY_LEGACY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Anzeigename des vom Nutzer gewählten Basisordners (über dem `edl`-Unterordner). */
export async function saveEdlLibraryBaseDisplayName(
  name: string | null,
  userId: string
): Promise<void> {
  const db = await openSettingsDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SETTINGS, "readwrite");
    const store = tx.objectStore(STORE_SETTINGS);
    const k = keyFor(userId);
    if (name === null || name === "") {
      store.delete(k);
    } else {
      store.put(name, k);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadEdlLibraryBaseDisplayName(userId: string): Promise<string | null> {
  try {
    const db = await openSettingsDb();
    let v = await new Promise<string | null>((resolve, reject) => {
      const tx = db.transaction(STORE_SETTINGS, "readonly");
      const req = tx.objectStore(STORE_SETTINGS).get(keyFor(userId));
      req.onsuccess = () => {
        const r = req.result;
        resolve(typeof r === "string" && r.trim() ? r.trim() : null);
      };
      req.onerror = () => reject(req.error);
    });
    if (v === null) {
      await migrateLegacyStringToUser(db, userId);
      v = await new Promise<string | null>((resolve, reject) => {
        const tx = db.transaction(STORE_SETTINGS, "readonly");
        const req = tx.objectStore(STORE_SETTINGS).get(keyFor(userId));
        req.onsuccess = () => {
          const r = req.result;
          resolve(typeof r === "string" && r.trim() ? r.trim() : null);
        };
        req.onerror = () => reject(req.error);
      });
    }
    return v;
  } catch {
    return null;
  }
}
