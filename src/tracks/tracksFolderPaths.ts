/**
 * Relative Pfade unter dem gewählten Tracks-Speicherort (z. B. "MeinProjekt/track.mp3").
 */

export function splitTracksRelativePath(relativePath: string): string[] {
  return relativePath.replace(/\\/g, "/").split("/").filter(Boolean);
}

/**
 * Datei relativ zum Tracks-Root — für Schreiben ggf. Zwischenordner anlegen.
 */
export async function getFileHandleInTracksRoot(
  root: FileSystemDirectoryHandle,
  relativePath: string,
  options: { create: boolean }
): Promise<FileSystemFileHandle> {
  const parts = splitTracksRelativePath(relativePath);
  if (parts.length === 0) throw new Error("Leerer Dateipfad.");
  let dir = root;
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i]!, { create: options.create });
  }
  return dir.getFileHandle(parts[parts.length - 1]!, { create: options.create });
}

/**
 * Ordner, der die Datei enthält, plus Dateiname — für Dateiauswahl startIn.
 */
export async function getDirectoryAndFileNameForTracksPath(
  root: FileSystemDirectoryHandle,
  relativePath: string
): Promise<{ dir: FileSystemDirectoryHandle; fileName: string }> {
  const parts = splitTracksRelativePath(relativePath);
  if (parts.length === 0) throw new Error("Leerer Dateipfad.");
  const fileName = parts[parts.length - 1]!;
  let dir = root;
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i]!, { create: false });
  }
  return { dir, fileName };
}

/** Löscht eine Datei relativ zum Tracks-Root (z. B. `Unterordner/track.mp3`). */
export async function removeFileRelativeToTracksRoot(
  root: FileSystemDirectoryHandle,
  relativePath: string
): Promise<void> {
  const parts = splitTracksRelativePath(relativePath);
  if (parts.length === 0) throw new Error("Leerer Pfad.");
  let dir = root;
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i]!, { create: false });
  }
  await dir.removeEntry(parts[parts.length - 1]!);
}
