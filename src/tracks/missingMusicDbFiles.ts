import { getFileHandleInTracksRoot } from "./tracksFolderPaths";

/**
 * Liefert alle Pfade aus `relativePaths`, die unter dem Speicherort nicht als Datei existieren
 * (z. B. gelöscht oder verschoben — dann bleiben oft noch Listeneinträge in der Musikdatenbank).
 */
export async function getMusicDbPathsMissingOnDisk(
  tracksDir: FileSystemDirectoryHandle,
  relativePaths: string[]
): Promise<string[]> {
  const missing: string[] = [];
  for (const p of relativePaths) {
    try {
      await getFileHandleInTracksRoot(tracksDir, p, { create: false });
    } catch {
      missing.push(p);
    }
  }
  return missing;
}

/** Gleiche Logik für serverseitige Fake-MP3s (`exists`-Callback z. B. API). */
export async function getMusicDbPathsMissingOnServer(
  exists: (relativePath: string) => Promise<boolean>,
  relativePaths: string[]
): Promise<string[]> {
  const missing: string[] = [];
  for (const p of relativePaths) {
    if (!(await exists(p))) missing.push(p);
  }
  return missing;
}
