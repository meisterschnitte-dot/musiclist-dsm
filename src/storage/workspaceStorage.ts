import type { PlaylistEntry } from "../edl/types";
import { openSettingsDb, STORE_SETTINGS } from "./idb";

const KEY_PREFIX = "workspaceV1:";
const KEY_LEGACY = "workspaceV1";

function keyFor(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

export type PersistedWorkspaceV1 = {
  v: 1;
  fileName: string;
  edlTitle: string | null;
  /** Leer, wenn nur noch die zusammengefasste Playlist ohne Roh-EDL (nach Fake-MP3-Export). */
  edlText: string;
  playlist: PlaylistEntry[];
  /** Fehlt bei älteren Speicherständen → wie „edl“, wenn edlText nicht leer. */
  sessionKind?: "edl" | "playlistLinked";
};

export function isPersistedWorkspaceV1(o: unknown): o is PersistedWorkspaceV1 {
  if (!o || typeof o !== "object") return false;
  const x = o as Record<string, unknown>;
  if (x.v !== 1) return false;
  if (typeof x.fileName !== "string" || typeof x.edlText !== "string") return false;
  if (!Array.isArray(x.playlist)) return false;
  return true;
}

export async function saveWorkspace(data: PersistedWorkspaceV1, userId: string): Promise<void> {
  try {
    const db = await openSettingsDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_SETTINGS, "readwrite");
      tx.objectStore(STORE_SETTINGS).put(data, keyFor(userId));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* Quota, private mode */
  }
}

async function getWorkspaceRaw(db: IDBDatabase, k: string): Promise<PersistedWorkspaceV1 | null> {
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SETTINGS, "readonly");
    const req = tx.objectStore(STORE_SETTINGS).get(k);
    req.onsuccess = () => {
      const raw = req.result as unknown;
      if (!raw || typeof raw !== "object") {
        resolve(null);
        return;
      }
      const o = raw as PersistedWorkspaceV1;
      if (o.v !== 1 || typeof o.edlText !== "string" || !Array.isArray(o.playlist)) {
        resolve(null);
        return;
      }
      if (!o.sessionKind && o.edlText.trim() === "" && o.playlist.length > 0) {
        o.sessionKind = "playlistLinked";
      }
      resolve(o);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function loadWorkspace(userId: string): Promise<PersistedWorkspaceV1 | null> {
  try {
    const db = await openSettingsDb();
    let w = await getWorkspaceRaw(db, keyFor(userId));
    if (!w) {
      const leg = await getWorkspaceRaw(db, KEY_LEGACY);
      if (leg) {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_SETTINGS, "readwrite");
          tx.objectStore(STORE_SETTINGS).put(leg, keyFor(userId));
          tx.objectStore(STORE_SETTINGS).delete(KEY_LEGACY);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        w = leg;
      }
    }
    return w;
  } catch {
    return null;
  }
}

export async function clearWorkspace(userId: string): Promise<void> {
  try {
    const db = await openSettingsDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_SETTINGS, "readwrite");
      tx.objectStore(STORE_SETTINGS).delete(keyFor(userId));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}
