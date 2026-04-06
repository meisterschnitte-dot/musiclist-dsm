import fs from "node:fs/promises";
import path from "node:path";
import { getDataDir } from "./userStore";
import type { PlaylistLibraryRef } from "./customerPlaylistAssignmentsFs";

const SHARED_DIR = path.join(getDataDir(), "shared");
const FILE = path.join(SHARED_DIR, "customer-playlist-pending.json");

function refKey(r: PlaylistLibraryRef): string {
  return JSON.stringify([r.libraryOwnerUserId, r.parentSegments, r.fileName]);
}

type Db = {
  /** Pro Bibliotheks-Playlist: welcher Kunde für Mail vorgemerkt (Kunde sieht die Datei noch nicht). */
  byRefKey: Record<string, { customerId: string; ref: PlaylistLibraryRef }>;
};

let chain: Promise<unknown> = Promise.resolve();

async function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn) as Promise<T>;
  chain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function defaultDb(): Db {
  return { byRefKey: {} };
}

async function readDb(): Promise<Db> {
  return serialize(async () => {
    try {
      const text = await fs.readFile(FILE, "utf8");
      const raw = JSON.parse(text) as unknown;
      if (!raw || typeof raw !== "object") return defaultDb();
      const p = raw as Partial<Db>;
      const byRefKey: Db["byRefKey"] = {};
      if (p.byRefKey && typeof p.byRefKey === "object") {
        for (const [k, v] of Object.entries(p.byRefKey)) {
          if (!v || typeof v !== "object") continue;
          const o = v as { customerId?: unknown; ref?: unknown };
          const customerId = typeof o.customerId === "string" ? o.customerId.trim() : "";
          const ref = o.ref as Partial<PlaylistLibraryRef> | undefined;
          if (!customerId || !ref || typeof ref !== "object") continue;
          const libraryOwnerUserId =
            typeof ref.libraryOwnerUserId === "string" ? ref.libraryOwnerUserId.trim() : "";
          const fileName = typeof ref.fileName === "string" ? ref.fileName.trim() : "";
          const parentSegments = Array.isArray(ref.parentSegments)
            ? ref.parentSegments.filter((x): x is string => typeof x === "string")
            : [];
          if (!libraryOwnerUserId || !fileName) continue;
          const full: PlaylistLibraryRef = { libraryOwnerUserId, parentSegments, fileName };
          byRefKey[k] = { customerId, ref: full };
        }
      }
      return { byRefKey };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return defaultDb();
      throw e;
    }
  });
}

async function writeDb(db: Db): Promise<void> {
  return serialize(async () => {
    await fs.mkdir(SHARED_DIR, { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(db, null, 2), "utf8");
  });
}

export async function registerPlaylistPending(customerId: string, ref: PlaylistLibraryRef): Promise<void> {
  const db = await readDb();
  const k = refKey(ref);
  db.byRefKey[k] = { customerId: customerId.trim(), ref };
  await writeDb(db);
}

export async function getPlaylistPendingCustomerForRef(ref: PlaylistLibraryRef): Promise<string | null> {
  const db = await readDb();
  const k = refKey(ref);
  return db.byRefKey[k]?.customerId ?? null;
}

export async function removePlaylistPendingForRef(ref: PlaylistLibraryRef): Promise<void> {
  const db = await readDb();
  const k = refKey(ref);
  if (!db.byRefKey[k]) return;
  delete db.byRefKey[k];
  await writeDb(db);
}
