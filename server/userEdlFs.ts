import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { getDataDir } from "./userStore";

export type EdlDirEntryFs = { name: string; kind: "file" | "directory" };

export function isPlaylistLibraryFileName(name: string): boolean {
  const l = name.toLowerCase();
  return l.endsWith(".list") || l.endsWith(".egpl");
}

function isEdlLibraryFileName(name: string): boolean {
  const l = name.toLowerCase();
  return (
    l.endsWith(".edl") ||
    l.endsWith(".xls") ||
    l.endsWith(".xlsx") ||
    isPlaylistLibraryFileName(name)
  );
}

function assertSafeSegment(seg: string): void {
  const t = seg.trim();
  if (!t || t === "." || t === ".." || t.includes("/") || t.includes("\\") || t.includes("\0")) {
    throw new Error("Ungültiger Pfadbestandteil.");
  }
}

function userEdlRootAbs(userId: string): string {
  if (!userId || !/^[a-zA-Z0-9-]{8,128}$/.test(userId)) {
    throw new Error("Ungültige Benutzer-ID.");
  }
  const root = path.join(getDataDir(), "users", userId, "edl");
  return root;
}

export async function ensureUserEdlRoot(userId: string): Promise<string> {
  const root = userEdlRootAbs(userId);
  await fs.mkdir(root, { recursive: true });
  return root;
}

function resolveUnderEdlRoot(userId: string, segments: string[]): string {
  const root = path.resolve(userEdlRootAbs(userId));
  for (const s of segments) assertSafeSegment(s);
  const full = path.resolve(root, ...segments);
  const rel = path.relative(root, full);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Pfad außerhalb der EDL-Bibliothek.");
  }
  return full;
}

export async function listUserEdlDirectory(
  userId: string,
  segments: string[]
): Promise<EdlDirEntryFs[]> {
  const dir = resolveUnderEdlRoot(userId, segments);
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      await ensureUserEdlRoot(userId);
      return listUserEdlDirectory(userId, segments);
    }
    throw e;
  }
  const out: EdlDirEntryFs[] = [];
  for (const ent of entries) {
    if (ent.isDirectory()) {
      out.push({ name: ent.name, kind: "directory" });
    } else if (ent.isFile() && isEdlLibraryFileName(ent.name)) {
      out.push({ name: ent.name, kind: "file" });
    }
  }
  out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name, "de");
  });
  return out;
}

export async function readUserEdlFileText(
  userId: string,
  segments: string[],
  fileName: string
): Promise<string> {
  assertSafeSegment(fileName);
  const fp = resolveUnderEdlRoot(userId, [...segments, fileName]);
  return fs.readFile(fp, "utf8");
}

export async function readUserEdlFileBuffer(
  userId: string,
  segments: string[],
  fileName: string
): Promise<Buffer> {
  assertSafeSegment(fileName);
  const fp = resolveUnderEdlRoot(userId, [...segments, fileName]);
  return fs.readFile(fp);
}

export async function writeUserEdlFileText(
  userId: string,
  segments: string[],
  fileName: string,
  text: string
): Promise<void> {
  assertSafeSegment(fileName);
  const dir = resolveUnderEdlRoot(userId, segments);
  await fs.mkdir(dir, { recursive: true });
  const fp = path.join(dir, fileName);
  await fs.writeFile(fp, text, "utf8");
}

export async function writeUserEdlFileBuffer(
  userId: string,
  segments: string[],
  fileName: string,
  data: Buffer
): Promise<void> {
  assertSafeSegment(fileName);
  const dir = resolveUnderEdlRoot(userId, segments);
  await fs.mkdir(dir, { recursive: true });
  const fp = path.join(dir, fileName);
  await fs.writeFile(fp, data);
}

export async function mkdirUserEdl(
  userId: string,
  parentSegments: string[],
  name: string
): Promise<void> {
  const trimmed = name.trim().replace(/[/\\]/g, "");
  if (!trimmed) throw new Error("Ungültiger Ordnername.");
  assertSafeSegment(trimmed);
  const dir = resolveUnderEdlRoot(userId, [...parentSegments, trimmed]);
  await fs.mkdir(dir, { recursive: true });
}

export async function deleteUserEdlFile(
  userId: string,
  segments: string[],
  fileName: string
): Promise<void> {
  assertSafeSegment(fileName);
  const fp = resolveUnderEdlRoot(userId, [...segments, fileName]);
  await fs.unlink(fp);
}

export async function deleteUserEdlDirectory(
  userId: string,
  pathSegments: string[]
): Promise<void> {
  if (pathSegments.length === 0) throw new Error("Wurzelordner kann nicht gelöscht werden.");
  for (const s of pathSegments) assertSafeSegment(s);
  const dir = resolveUnderEdlRoot(userId, pathSegments);
  await fs.rm(dir, { recursive: true, force: true });
}

export async function moveUserEdlFile(
  userId: string,
  fromSegments: string[],
  fileName: string,
  toSegments: string[]
): Promise<void> {
  assertSafeSegment(fileName);
  const fromPath = resolveUnderEdlRoot(userId, [...fromSegments, fileName]);
  const destDir = resolveUnderEdlRoot(userId, toSegments);
  await fs.mkdir(destDir, { recursive: true });
  const toPath = path.join(destDir, fileName);
  await fs.rename(fromPath, toPath);
}

/** Verschiebt einen Unterordner (`fromParent` + `folderName`) nach `toParentSegments`. */
export async function moveUserEdlDirectory(
  userId: string,
  fromParentSegments: string[],
  folderName: string,
  toParentSegments: string[]
): Promise<void> {
  assertSafeSegment(folderName);
  const sourcePathSegments = [...fromParentSegments, folderName];
  if (
    fromParentSegments.length === toParentSegments.length &&
    fromParentSegments.every((s, i) => s === toParentSegments[i])
  ) {
    return;
  }
  if (
    toParentSegments.length >= sourcePathSegments.length &&
    sourcePathSegments.every((s, i) => s === toParentSegments[i])
  ) {
    throw new Error("Ordner kann nicht in sich selbst oder einen Unterordner verschoben werden.");
  }
  if (await nameTakenInParent(userId, toParentSegments, folderName)) {
    throw new Error("Ein Ordner oder eine Datei mit diesem Namen existiert bereits.");
  }
  const srcPath = resolveUnderEdlRoot(userId, sourcePathSegments);
  const destDir = resolveUnderEdlRoot(userId, toParentSegments);
  const destPath = path.join(destDir, folderName);
  await fs.mkdir(destDir, { recursive: true });
  await fs.rename(srcPath, destPath);
}

async function isFileAt(userId: string, segments: string[], name: string): Promise<boolean> {
  try {
    const fp = resolveUnderEdlRoot(userId, [...segments, name]);
    const st = await fs.stat(fp);
    return st.isFile();
  } catch {
    return false;
  }
}

async function isDirAt(userId: string, segments: string[], name: string): Promise<boolean> {
  try {
    const fp = resolveUnderEdlRoot(userId, [...segments, name]);
    const st = await fs.stat(fp);
    return st.isDirectory();
  } catch {
    return false;
  }
}

async function nameTakenInParent(
  userId: string,
  parentSegments: string[],
  name: string
): Promise<boolean> {
  return (
    (await isDirAt(userId, parentSegments, name)) ||
    (await isFileAt(userId, parentSegments, name))
  );
}

async function moveAllEntriesFs(
  userId: string,
  srcSegments: string[],
  destSegments: string[]
): Promise<void> {
  const entries = await fs.readdir(resolveUnderEdlRoot(userId, srcSegments), {
    withFileTypes: true,
  });
  for (const ent of entries) {
    const fromSegs = [...srcSegments, ent.name];
    if (ent.isDirectory()) {
      await fs.mkdir(resolveUnderEdlRoot(userId, [...destSegments, ent.name]), { recursive: true });
      await moveAllEntriesFs(userId, fromSegs, [...destSegments, ent.name]);
      await fs.rm(resolveUnderEdlRoot(userId, fromSegs), { recursive: true, force: true });
    } else if (ent.isFile()) {
      await moveUserEdlFile(userId, srcSegments, ent.name, destSegments);
    }
  }
}

export async function renameUserEdlSubdirectory(
  userId: string,
  parentSegments: string[],
  oldName: string,
  newName: string
): Promise<void> {
  const trimmed = newName.trim().replace(/[/\\]/g, "");
  if (!trimmed) throw new Error("Ungültiger Ordnername.");
  assertSafeSegment(trimmed);
  assertSafeSegment(oldName);
  if (trimmed === oldName) return;
  if (await nameTakenInParent(userId, parentSegments, trimmed)) {
    throw new Error("Ein Ordner oder eine Datei mit diesem Namen existiert bereits.");
  }
  const oldDirSegs = [...parentSegments, oldName];
  const newDirSegs = [...parentSegments, trimmed];
  await fs.mkdir(resolveUnderEdlRoot(userId, newDirSegs), { recursive: true });
  await moveAllEntriesFs(userId, oldDirSegs, newDirSegs);
  await fs.rm(resolveUnderEdlRoot(userId, oldDirSegs), { recursive: true, force: true });
}
