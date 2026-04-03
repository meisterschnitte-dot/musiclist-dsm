const DB_NAME = "musiclist-dsm";
const DB_NAME_LEGACY = "easy-gema-dsm";
const DB_VERSION = 1;
export const STORE_SETTINGS = "settings";

function migrateFromLegacyIdbIfEmpty(newDb: IDBDatabase): Promise<void> {
  return new Promise((resolve) => {
    const tx = newDb.transaction(STORE_SETTINGS, "readonly");
    const countReq = tx.objectStore(STORE_SETTINGS).count();
    countReq.onerror = () => resolve();
    countReq.onsuccess = () => {
      if (countReq.result > 0) {
        resolve();
        return;
      }
      const legReq = indexedDB.open(DB_NAME_LEGACY, DB_VERSION);
      legReq.onerror = () => resolve();
      legReq.onsuccess = () => {
        const legDb = legReq.result;
        if (!legDb.objectStoreNames.contains(STORE_SETTINGS)) {
          legDb.close();
          resolve();
          return;
        }
        const ltx = legDb.transaction(STORE_SETTINGS, "readonly");
        const curReq = ltx.objectStore(STORE_SETTINGS).openCursor();
        const entries: { key: IDBValidKey; value: unknown }[] = [];
        curReq.onerror = () => {
          legDb.close();
          resolve();
        };
        curReq.onsuccess = () => {
          const cursor = curReq.result;
          if (cursor) {
            entries.push({ key: cursor.key, value: cursor.value });
            cursor.continue();
          } else {
            legDb.close();
            if (entries.length === 0) {
              resolve();
              return;
            }
            const wtx = newDb.transaction(STORE_SETTINGS, "readwrite");
            const ws = wtx.objectStore(STORE_SETTINGS);
            for (const e of entries) {
              ws.put(e.value, e.key);
            }
            wtx.oncomplete = () => resolve();
            wtx.onerror = () => resolve();
          }
        };
      };
    };
  });
}

export function openSettingsDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) db.createObjectStore(STORE_SETTINGS);
    };
    req.onsuccess = () => {
      const db = req.result;
      void migrateFromLegacyIdbIfEmpty(db).then(() => resolve(db));
    };
  });
}
