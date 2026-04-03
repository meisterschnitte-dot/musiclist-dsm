import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { getDataDir } from "./userStore";

const SHARED_DIR = path.join(getDataDir(), "shared");
const TRACKS_ROOT = path.join(SHARED_DIR, "tracks");
const INDEX_FILE = path.join(SHARED_DIR, "music-database-index.json");

let indexChain: Promise<void> = Promise.resolve();

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
  const unique = [...new Set(paths.map((p) => p.replace(/\\/g, "/").trim()).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b, "de")
  );
  await fs.writeFile(INDEX_FILE, JSON.stringify(unique, null, 2), "utf8");
}

function runIndexMutation(fn: () => Promise<void>): Promise<void> {
  const run = indexChain.then(fn);
  indexChain = run.catch(() => {});
  return run;
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
  for (const p of fromDisk) set.add(p.replace(/\\/g, "/"));
  for (const p of fromIndex) set.add(p.replace(/\\/g, "/"));
  return [...set].sort((a, b) => a.localeCompare(b, "de"));
}

export async function registerMusicDatabasePaths(paths: string[]): Promise<string[]> {
  const norm = paths.map((p) => p.replace(/\\/g, "/").trim()).filter(Boolean);
  if (norm.length === 0) return getMergedMusicDatabasePaths();
  await runIndexMutation(async () => {
    const cur = await readIndexRaw();
    const s = new Set([...cur, ...norm].map((x) => x.replace(/\\/g, "/")));
    await writeIndexRaw([...s]);
  });
  return getMergedMusicDatabasePaths();
}

/** Nur Index-Einträge entfernen (z. B. verwaiste Pfade ohne Datei auf der Platte). */
export async function removeMusicDatabaseIndexPaths(paths: string[]): Promise<string[]> {
  const norm = paths.map((p) => p.replace(/\\/g, "/").trim()).filter(Boolean);
  if (norm.length === 0) return getMergedMusicDatabasePaths();
  const rm = new Set(norm);
  await runIndexMutation(async () => {
    const cur = await readIndexRaw();
    const next = cur.filter((p) => !rm.has(p.replace(/\\/g, "/")));
    await writeIndexRaw(next);
  });
  return getMergedMusicDatabasePaths();
}

async function addPathToIndexIfNeeded(relPosix: string): Promise<void> {
  const p = relPosix.replace(/\\/g, "/");
  await runIndexMutation(async () => {
    const current = await readIndexRaw();
    const s = new Set(current.map((x) => x.replace(/\\/g, "/")));
    s.add(p);
    await writeIndexRaw([...s]);
  });
}

async function removePathFromIndex(relPosix: string): Promise<void> {
  const p = relPosix.replace(/\\/g, "/");
  await runIndexMutation(async () => {
    const current = await readIndexRaw();
    const next = current.filter((x) => x.replace(/\\/g, "/") !== p);
    await writeIndexRaw(next);
  });
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
  await fs.mkdir(path.dirname(fp), { recursive: true });
  await fs.writeFile(fp, data);
  const root = path.resolve(TRACKS_ROOT);
  const rel = path.relative(root, fp).replace(/\\/g, "/");
  await addPathToIndexIfNeeded(rel);
}

export async function deleteSharedMp3File(relativePath: string): Promise<void> {
  const fp = parseAndResolveMp3RelativePath(relativePath);
  const root = path.resolve(TRACKS_ROOT);
  const rel = path.relative(root, fp).replace(/\\/g, "/");
  try {
    await fs.unlink(fp);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  await removePathFromIndex(rel);
}
