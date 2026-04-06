import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { getDataDir } from "./userStore";

const SHARED_DIR = path.join(getDataDir(), "shared");
const TRACKS_ROOT = path.join(SHARED_DIR, "tracks");
const INDEX_FILE = path.join(SHARED_DIR, "music-database-index.json");
const META_FILE = path.join(SHARED_DIR, "music-database-metadata.json");

export type MusicDbMetaEntry = { createdAt: string; updatedAt: string };

let dbChain: Promise<unknown> = Promise.resolve();

async function serializeDb<T>(fn: () => Promise<T>): Promise<T> {
  const run = dbChain.then(fn, fn) as Promise<T>;
  dbChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function normPath(p: string): string {
  return p.replace(/\\/g, "/").trim();
}

function assertSafeSegment(seg: string): void {
  const t = seg.trim();
  if (!t || t === "." || t === ".." || t.includes("/") || t.includes("\\") || t.includes("\0")) {
    throw new Error("Ungültiger Pfadbestandteil.");
  }
}

/** Relativer POSIX-Pfad unter `shared/tracks`; Datei muss `.mp3` sein. */
export function parseAndResolveMp3RelativePath(relativePath: string): string {
  const norm = relativePath.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!norm.toLowerCase().endsWith(".mp3")) {
    throw new Error("Nur .mp3-Dateien sind erlaubt.");
  }
  const parts = norm.split("/").filter(Boolean);
  if (parts.length === 0) throw new Error("Leerer Dateipfad.");
  for (const p of parts) assertSafeSegment(p);
  const root = path.resolve(TRACKS_ROOT);
  const full = path.resolve(root, ...parts);
  const rel = path.relative(root, full);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Pfad außerhalb des MP3-Speicherorts.");
  }
  return full;
}

export async function ensureSharedTracksRoot(): Promise<void> {
  await fs.mkdir(TRACKS_ROOT, { recursive: true });
}

async function readIndexRaw(): Promise<string[]> {
  try {
    const raw = await fs.readFile(INDEX_FILE, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}

async function writeIndexRaw(paths: string[]): Promise<void> {
  await fs.mkdir(SHARED_DIR, { recursive: true });
  const unique = [...new Set(paths.map((p) => normPath(p)).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "de")
  );
  await fs.writeFile(INDEX_FILE, JSON.stringify(unique, null, 2), "utf8");
}

async function readMetadataRaw(): Promise<Record<string, MusicDbMetaEntry>> {
  try {
    const raw = await fs.readFile(META_FILE, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, MusicDbMetaEntry> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!v || typeof v !== "object") continue;
      const o = v as Record<string, unknown>;
      if (typeof o.createdAt === "string" && typeof o.updatedAt === "string") {
        out[normPath(k)] = { createdAt: o.createdAt, updatedAt: o.updatedAt };
      }
    }
    return out;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw e;
  }
}

async function writeMetadataRaw(map: Record<string, MusicDbMetaEntry>): Promise<void> {
  await fs.mkdir(SHARED_DIR, { recursive: true });
  const sortedKeys = Object.keys(map).sort((a, b) => a.localeCompare(b, "de"));
  const ordered: Record<string, MusicDbMetaEntry> = {};
  for (const k of sortedKeys) ordered[k] = map[k]!;
  await fs.writeFile(META_FILE, JSON.stringify(ordered, null, 2), "utf8");
}

async function statTimestampsForMp3(relativePath: string): Promise<MusicDbMetaEntry | null> {
  try {
    const fp = parseAndResolveMp3RelativePath(relativePath);
    const st = await fs.stat(fp);
    const c = st.birthtimeMs > 0 ? st.birthtime : st.mtime;
    return {
      createdAt: new Date(c).toISOString(),
      updatedAt: new Date(st.mtime).toISOString(),
    };
  } catch {
    return null;
  }
}

async function scanDiskMp3RelativePaths(): Promise<string[]> {
  await ensureSharedTracksRoot();
  const out: string[] = [];
  async function walk(dirAbs: string, prefix: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        await walk(path.join(dirAbs, ent.name), rel);
      } else if (ent.isFile() && ent.name.toLowerCase().endsWith(".mp3")) {
        out.push(rel.replace(/\\/g, "/"));
      }
    }
  }
  await walk(TRACKS_ROOT, "");
  return out;
}

/** Vereinigung aus Index-Datei und Dateisystem (sortiert, eindeutig). */
export async function getMergedMusicDatabasePaths(): Promise<string[]> {
  const [fromDisk, fromIndex] = await Promise.all([scanDiskMp3RelativePaths(), readIndexRaw()]);
  const set = new Set<string>();
  for (const p of fromDisk) set.add(normPath(p));
  for (const p of fromIndex) set.add(normPath(p));
  return [...set].sort((a, b) => a.localeCompare(b, "de"));
}

/** Pfade plus Metadaten; fehlende Einträge werden aus Dateisystem oder „jetzt“ ergänzt. */
export async function getMergedMusicDatabaseState(): Promise<{
  paths: string[];
  metadata: Record<string, MusicDbMetaEntry>;
}> {
  return await serializeDb(async () => {
    const paths = await getMergedMusicDatabasePaths();
    const pathKeys = new Set(paths.map(normPath));
    let map = await readMetadataRaw();
    let changed = false;
    const now = new Date().toISOString();
    for (const p of paths) {
      const k = normPath(p);
      if (!map[k]) {
        const inf = await statTimestampsForMp3(p);
        map[k] = inf ?? { createdAt: now, updatedAt: now };
        changed = true;
      }
    }
    for (const key of Object.keys(map)) {
      if (!pathKeys.has(key)) {
        delete map[key];
        changed = true;
      }
    }
    if (changed) await writeMetadataRaw(map);
    const metadata: Record<string, MusicDbMetaEntry> = {};
    for (const p of paths) {
      metadata[p] = map[normPath(p)]!;
    }
    return { paths, metadata };
  });
}

export async function registerMusicDatabasePaths(
  paths: string[]
): Promise<{ paths: string[]; metadata: Record<string, MusicDbMetaEntry> }> {
  const norm = paths.map((p) => normPath(p)).filter(Boolean);
  if (norm.length === 0) return getMergedMusicDatabaseState();
  await serializeDb(async () => {
    const cur = await readIndexRaw();
    const prevSet = new Set(cur.map(normPath));
    const s = new Set([...cur.map(normPath), ...norm]);
    await writeIndexRaw([...s]);
    const map = await readMetadataRaw();
    const now = new Date().toISOString();
    for (const p of norm) {
      const k = normPath(p);
      if (!prevSet.has(k) && !map[k]) {
        const inf = await statTimestampsForMp3(p);
        map[k] = inf ?? { createdAt: now, updatedAt: now };
      }
    }
    await writeMetadataRaw(map);
  });
  return getMergedMusicDatabaseState();
}

/** Nur Index-Einträge entfernen (z. B. verwaiste Pfade ohne Datei auf der Platte). */
export async function removeMusicDatabaseIndexPaths(
  paths: string[]
): Promise<{ paths: string[]; metadata: Record<string, MusicDbMetaEntry> }> {
  const norm = paths.map((p) => normPath(p)).filter(Boolean);
  if (norm.length === 0) return getMergedMusicDatabaseState();
  const rm = new Set(norm.map(normPath));
  await serializeDb(async () => {
    const cur = await readIndexRaw();
    const next = cur.filter((p) => !rm.has(normPath(p)));
    await writeIndexRaw(next);
    const map = await readMetadataRaw();
    for (const k of rm) delete map[k];
    await writeMetadataRaw(map);
  });
  return getMergedMusicDatabaseState();
}

export async function readSharedMp3Buffer(relativePath: string): Promise<Buffer> {
  const fp = parseAndResolveMp3RelativePath(relativePath);
  return fs.readFile(fp);
}

export async function sharedMp3FileExists(relativePath: string): Promise<boolean> {
  try {
    const fp = parseAndResolveMp3RelativePath(relativePath);
    const st = await fs.stat(fp);
    return st.isFile();
  } catch {
    return false;
  }
}

export async function writeSharedMp3Buffer(relativePath: string, data: Buffer): Promise<void> {
  const fp = parseAndResolveMp3RelativePath(relativePath);
  let existedBefore = false;
  try {
    const st = await fs.stat(fp);
    existedBefore = st.isFile();
  } catch {
    existedBefore = false;
  }
  await fs.mkdir(path.dirname(fp), { recursive: true });
  await fs.writeFile(fp, data);
  const root = path.resolve(TRACKS_ROOT);
  const rel = path.relative(root, fp).replace(/\\/g, "/");
  await serializeDb(async () => {
    const current = await readIndexRaw();
    const s = new Set(current.map(normPath));
    s.add(rel);
    await writeIndexRaw([...s]);
    const map = await readMetadataRaw();
    const k = normPath(rel);
    const now = new Date().toISOString();
    if (!existedBefore) {
      map[k] = { createdAt: now, updatedAt: now };
    } else if (!map[k]) {
      const inf = await statTimestampsForMp3(rel);
      map[k] = inf ?? { createdAt: now, updatedAt: now };
    } else {
      /* Überschreiben (z. B. Transfer / ID3): Spalte „Bearbeitet“ aktualisieren */
      map[k] = { createdAt: map[k]!.createdAt, updatedAt: now };
    }
    await writeMetadataRaw(map);
  });
}

export async function deleteSharedMp3File(relativePath: string): Promise<void> {
  const fp = parseAndResolveMp3RelativePath(relativePath);
  const root = path.resolve(TRACKS_ROOT);
  const rel = path.relative(root, fp).replace(/\\/g, "/");
  const k = normPath(rel);
  try {
    await fs.unlink(fp);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  await serializeDb(async () => {
    const current = await readIndexRaw();
    const next = current.filter((p) => normPath(p) !== k);
    await writeIndexRaw(next);
    const map = await readMetadataRaw();
    delete map[k];
    await writeMetadataRaw(map);
  });
}

/** Nach erfolgreichem ID3-Schreiben: `updatedAt` auf jetzt (Eintrag wird bei Bedarf angelegt). */
export async function touchMusicDbTagEdited(relativePath: string): Promise<MusicDbMetaEntry> {
  const k = normPath(relativePath);
  return await serializeDb(async () => {
    const map = await readMetadataRaw();
    const now = new Date().toISOString();
    if (!map[k]) {
      const inf = await statTimestampsForMp3(relativePath);
      map[k] = inf ?? { createdAt: now, updatedAt: now };
    }
    map[k] = { createdAt: map[k]!.createdAt, updatedAt: now };
    await writeMetadataRaw(map);
    return map[k]!;
  });
}
