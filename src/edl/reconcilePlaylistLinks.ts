import type { PlaylistEntry } from "./types";

function normPath(p: string): string {
  return p.trim().replace(/\\/g, "/").toLowerCase();
}

/** Exakter relativer Pfad in der Musikdatenbank (kein Basename-Fallback). */
export function musicDbHasExactPath(musicDbPaths: readonly string[], linkedRelativePath: string): boolean {
  const want = normPath(linkedRelativePath);
  if (!want) return false;
  return musicDbPaths.some((p) => normPath(p) === want);
}

/**
 * Entfernt `linkedTrackFileName`, wenn die Datei am gespeicherten Pfad nicht mehr existiert
 * (z. B. anderer Speicherort / gelöscht).
 */
export function reconcilePlaylistLinksToMusicDb(
  playlist: PlaylistEntry[],
  musicDbPaths: readonly string[]
): { playlist: PlaylistEntry[]; changed: boolean; clearedCount: number } {
  let changed = false;
  let clearedCount = 0;
  const next = playlist.map((row) => {
    const linked = row.linkedTrackFileName?.trim();
    if (!linked) return row;
    if (musicDbHasExactPath(musicDbPaths, linked)) return row;
    changed = true;
    clearedCount += 1;
    return { ...row, linkedTrackFileName: undefined };
  });
  return { playlist: next, changed, clearedCount };
}
