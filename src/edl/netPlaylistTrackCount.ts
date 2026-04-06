import type { PlaylistEntry } from "./types";

/**
 * Identität der Quelle pro Zeile — analog zu mergePlaylist (Dateiname ohne Pfad, klein).
 */
function playlistRowSourceIdentity(row: PlaylistEntry): string {
  const linked = row.linkedTrackFileName?.trim();
  if (linked) {
    return linked.replace(/^.*[/\\]/, "").trim().toLowerCase();
  }
  return row.sourceKey.trim().toLowerCase();
}

/**
 * Nettomenge: unterschiedliche Quell-Tracks. Dieselbe MP3 kann mehrfach in der Liste stehen,
 * wenn der Abstand im Programm > 5 s ist (kein Zusammenfassen) — für die Nettomenge zählt sie nur einmal.
 */
export function netPlaylistTrackCount(playlist: PlaylistEntry[]): number {
  const seen = new Set<string>();
  for (const row of playlist) {
    const id = playlistRowSourceIdentity(row);
    if (id) seen.add(id);
  }
  return seen.size;
}
