import fs from "node:fs/promises";
import path from "node:path";
import { getDataDir } from "./userStore";

const SHARED_DIR = path.join(getDataDir(), "shared");
const FILE = path.join(SHARED_DIR, "customer-playlist-assignments.json");

export type PlaylistLibraryRef = {
  /** EDL-Bibliothek unter `data/users/<id>/edl/` (Admin, der die Playlist versendet hat). */
  libraryOwnerUserId: string;
  parentSegments: string[];
  fileName: string;
};

type Db = {
  /** Kunde → zugewiesene Bibliotheksdateien (nach Mail-Versand). */
  byCustomer: Record<string, PlaylistLibraryRef[]>;
};

function refKey(r: PlaylistLibraryRef): string {
  return JSON.stringify([r.libraryOwnerUserId, r.parentSegments, r.fileName]);
}

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
  return { byCustomer: {} };
}

export async function readAssignmentsDb(): Promise<Db> {
  return serialize(async () => {
    try {
      const text = await fs.readFile(FILE, "utf8");
      const raw = JSON.parse(text) as unknown;
      if (!raw || typeof raw !== "object") return defaultDb();
      const p = raw as Partial<Db>;
      const byCustomer: Record<string, PlaylistLibraryRef[]> = {};
      if (p.byCustomer && typeof p.byCustomer === "object") {
        for (const [cid, list] of Object.entries(p.byCustomer)) {
          if (!cid.trim() || !Array.isArray(list)) continue;
          const refs: PlaylistLibraryRef[] = [];
          const seen = new Set<string>();
          for (const item of list) {
            if (!item || typeof item !== "object") continue;
            const o = item as Partial<PlaylistLibraryRef>;
            const libraryOwnerUserId =
              typeof o.libraryOwnerUserId === "string" ? o.libraryOwnerUserId.trim() : "";
            const fileName = typeof o.fileName === "string" ? o.fileName.trim() : "";
            const parentSegments = Array.isArray(o.parentSegments)
              ? o.parentSegments.filter((x): x is string => typeof x === "string")
              : [];
            if (!libraryOwnerUserId || !fileName) continue;
            const r: PlaylistLibraryRef = { libraryOwnerUserId, parentSegments, fileName };
            const k = refKey(r);
            if (seen.has(k)) continue;
            seen.add(k);
            refs.push(r);
          }
          if (refs.length) byCustomer[cid.trim()] = refs;
        }
      }
      return { byCustomer };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return defaultDb();
      throw e;
    }
  });
}

export async function writeAssignmentsDb(db: Db): Promise<void> {
  return serialize(async () => {
    await fs.mkdir(SHARED_DIR, { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(db, null, 2), "utf8");
  });
}

export async function registerPlaylistAssignmentForCustomer(
  customerId: string,
  ref: PlaylistLibraryRef
): Promise<void> {
  const id = customerId.trim();
  if (!id) return;
  const db = await readAssignmentsDb();
  const list = db.byCustomer[id] ?? [];
  const k = refKey(ref);
  if (list.some((r) => refKey(r) === k)) return;
  db.byCustomer[id] = [...list, ref];
  await writeAssignmentsDb(db);
}

export async function getAssignmentsForCustomer(customerId: string): Promise<PlaylistLibraryRef[]> {
  const db = await readAssignmentsDb();
  return db.byCustomer[customerId.trim()] ?? [];
}

export async function removePlaylistAssignmentForCustomer(
  customerId: string,
  ref: PlaylistLibraryRef
): Promise<boolean> {
  const id = customerId.trim();
  if (!id) return false;
  const db = await readAssignmentsDb();
  const list = db.byCustomer[id] ?? [];
  if (list.length === 0) return false;
  const k = refKey(ref);
  const next = list.filter((r) => refKey(r) !== k);
  if (next.length === list.length) return false;
  if (next.length === 0) {
    delete db.byCustomer[id];
  } else {
    db.byCustomer[id] = next;
  }
  await writeAssignmentsDb(db);
  return true;
}
