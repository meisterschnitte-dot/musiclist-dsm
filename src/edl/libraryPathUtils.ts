/**
 * Ersetzt in einem Pfad ein umbenanntes Ordner-Präfix (z. B. `a/b` → `a/c`).
 * Nur wenn `segments` mit `oldFolderPath` beginnt.
 */
export function replaceFolderPathPrefix(
  segments: string[],
  oldFolderPath: string[],
  newFolderPath: string[]
): string[] {
  if (segments.length < oldFolderPath.length) return segments;
  for (let i = 0; i < oldFolderPath.length; i++) {
    if (segments[i] !== oldFolderPath[i]) return segments;
  }
  return [...newFolderPath, ...segments.slice(oldFolderPath.length)];
}
