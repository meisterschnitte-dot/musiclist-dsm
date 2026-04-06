import { isPlaylistLibraryFileName } from "./playlistLibraryFile";

/** Alle EDL-Dateien und Unterordner liegen unter diesem Namen relativ zum gewählten Basisordner. */
export const EDL_LIBRARY_FOLDER_NAME = "edl";

export type EdlDirEntry = {
  name: string;
  kind: "file" | "directory";
  /** Optional: Anzeigename (Navigation nutzt weiterhin `name`). */
  label?: string;
};

/** Unterordner `edl` unter dem vom Nutzer gewählten Verzeichnis anlegen bzw. öffnen. */
export async function getOrCreateEdlLibraryRoot(
  pickedDirectory: FileSystemDirectoryHandle
): Promise<FileSystemDirectoryHandle> {
  return pickedDirectory.getDirectoryHandle(EDL_LIBRARY_FOLDER_NAME, { create: true });
}

/** Pfad als Segmente relativ zur EDL-Wurzel, z. B. `["2024", "Jan"]`. */
export async function resolveEdlDir(
  root: FileSystemDirectoryHandle,
  pathSegments: string[]
): Promise<FileSystemDirectoryHandle> {
  let d = root;
  for (const seg of pathSegments) {
    d = await d.getDirectoryHandle(seg);
  }
  return d;
}

export async function listEdlDirectory(dir: FileSystemDirectoryHandle): Promise<EdlDirEntry[]> {
  const out: EdlDirEntry[] = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === "directory") {
      out.push({ name, kind: "directory" });
    } else if (
      name.toLowerCase().endsWith(".edl") ||
      name.toLowerCase().endsWith(".xls") ||
      isPlaylistLibraryFileName(name)
    ) {
      out.push({ name, kind: "file" });
    }
  }
  out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name, "de");
  });
  return out;
}

export async function writeEdlFile(
  dir: FileSystemDirectoryHandle,
  fileName: string,
  text: string
): Promise<void> {
  const enc = new TextEncoder();
  const handle = await dir.getFileHandle(fileName, { create: true });
  const writable = await handle.createWritable();
  await writable.write(enc.encode(text));
  await writable.close();
}

/** Binär (z. B. GEMA-`.xls`) in die EDL-Bibliothek schreiben. */
export async function writeEdlBinaryFile(
  dir: FileSystemDirectoryHandle,
  fileName: string,
  data: ArrayBuffer | Uint8Array
): Promise<void> {
  const handle = await dir.getFileHandle(fileName, { create: true });
  const writable = await handle.createWritable();
  await writable.write(data);
  await writable.close();
}

/** Gespeicherte MP3-Playlist (`.list` / `.egpl`, JSON) — gleiche Schreiblogik wie EDL-Text. */
export async function writePlaylistLibraryFile(
  dir: FileSystemDirectoryHandle,
  fileName: string,
  jsonText: string
): Promise<void> {
  await writeEdlFile(dir, fileName, jsonText);
}

export async function readEdlFileText(file: FileSystemFileHandle): Promise<string> {
  const f = await file.getFile();
  return f.text();
}

export async function createSubfolder(
  parent: FileSystemDirectoryHandle,
  name: string
): Promise<FileSystemDirectoryHandle> {
  const trimmed = name.trim().replace(/[/\\]/g, "");
  if (!trimmed) throw new Error("Ungültiger Ordnername.");
  return parent.getDirectoryHandle(trimmed, { create: true });
}

export async function moveEdlFile(
  sourceDir: FileSystemDirectoryHandle,
  fileName: string,
  destDir: FileSystemDirectoryHandle
): Promise<void> {
  if (sourceDir === destDir) return;
  const fh = await sourceDir.getFileHandle(fileName);
  const file = await fh.getFile();
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xls")) {
    const buf = await file.arrayBuffer();
    await writeEdlBinaryFile(destDir, fileName, buf);
  } else {
    const text = await file.text();
    await writeEdlFile(destDir, fileName, text);
  }
  await sourceDir.removeEntry(fileName);
}

async function entryIsFile(
  parent: FileSystemDirectoryHandle,
  name: string
): Promise<boolean> {
  try {
    await parent.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

/** Alle Einträge von `src` nach `dest` verschieben (rekursiv bei Unterordnern). */
async function moveAllEntriesInto(
  src: FileSystemDirectoryHandle,
  dest: FileSystemDirectoryHandle
): Promise<void> {
  const names: string[] = [];
  for await (const [name] of src.entries()) {
    names.push(name);
  }
  for (const name of names) {
    if (await entryIsFile(src, name)) {
      await moveEdlFile(src, name, dest);
    } else {
      const subSrc = await src.getDirectoryHandle(name);
      const subDest = await dest.getDirectoryHandle(name, { create: true });
      await moveAllEntriesInto(subSrc, subDest);
      await src.removeEntry(name, { recursive: true });
    }
  }
}

async function nameTakenInParent(
  parent: FileSystemDirectoryHandle,
  name: string
): Promise<boolean> {
  try {
    await parent.getDirectoryHandle(name);
    return true;
  } catch {
    /* kein Ordner */
  }
  try {
    await parent.getFileHandle(name);
    return true;
  } catch {
    /* keine Datei */
  }
  return false;
}

/**
 * Ordner unter `parent` umbenennen (Inhalt bleibt erhalten).
 * `newName` ohne Pfadtrenner; Kollision mit vorhandenem Namen → Fehler.
 */
export async function renameEdlSubdirectory(
  parent: FileSystemDirectoryHandle,
  oldName: string,
  newName: string
): Promise<void> {
  const trimmed = newName.trim().replace(/[/\\]/g, "");
  if (!trimmed) throw new Error("Ungültiger Ordnername.");
  if (trimmed === oldName) return;
  if (await nameTakenInParent(parent, trimmed)) {
    throw new Error("Ein Ordner oder eine Datei mit diesem Namen existiert bereits.");
  }
  const oldDir = await parent.getDirectoryHandle(oldName);
  const newDir = await parent.getDirectoryHandle(trimmed, { create: true });
  await moveAllEntriesInto(oldDir, newDir);
  await parent.removeEntry(oldName, { recursive: true });
}

export async function removeEdlFileEntry(
  parent: FileSystemDirectoryHandle,
  fileName: string
): Promise<void> {
  await parent.removeEntry(fileName);
}

/** Ordner inkl. Inhalt löschen (rekursiv). */
export async function removeEdlDirectoryEntry(
  parent: FileSystemDirectoryHandle,
  directoryName: string
): Promise<void> {
  await parent.removeEntry(directoryName, { recursive: true });
}
