const MAX_LEN = 180;

/** Letztes Pfadsegment (relativer Pfad mit / oder \). */
export function basenamePath(path: string): string {
  const n = path.replace(/\\/g, "/");
  const i = n.lastIndexOf("/");
  return i >= 0 ? n.slice(i + 1) : n;
}

/**
 * Musikdatenbank-Eintrag zu einem verknüpften Pfad: zuerst exakter Pfad,
 * sonst gleicher Dateiname in beliebigem Unterordner (Ordner wird ignoriert).
 */
export function resolveMusicDbPathForBasename(
  musicDbPaths: string[],
  linkedRelativePath: string
): string | null {
  const exact = musicDbPaths.find((n) => n.toLowerCase() === linkedRelativePath.toLowerCase());
  if (exact) return exact;
  const base = basenamePath(linkedRelativePath).toLowerCase();
  return musicDbPaths.find((p) => basenamePath(p).toLowerCase() === base) ?? null;
}

/** Dateiname ohne Pfad, gültig unter Windows/macOS. */
export function sanitizeFilenameStem(title: string): string {
  let s = title
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) s = "Track";
  if (s.length > MAX_LEN) s = s.slice(0, MAX_LEN).trim();
  return s;
}

export function stripExtension(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".mp3")) return filename.slice(0, -4);
  return filename;
}

/**
 * EDL- oder Playlist-Dateiname → Ordnername für MP3-Unterordner (ohne Endung, sanitisiert).
 */
export function stemForProjectFolder(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".edl")) return sanitizeFilenameStem(fileName.slice(0, -4));
  if (lower.endsWith(".list")) return sanitizeFilenameStem(fileName.slice(0, -5));
  if (lower.endsWith(".egpl")) return sanitizeFilenameStem(fileName.slice(0, -5));
  return sanitizeFilenameStem(stripExtension(fileName));
}
