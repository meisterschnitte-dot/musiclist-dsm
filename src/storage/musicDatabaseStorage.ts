/**
 * Legacy: früher lokale Zwischenspeicherung der Musikdatenbank-Liste.
 * Die Quelle der Wahrheit liegt auf dem Server; beim ersten Login werden alte Einträge migriert und
 * der Schlüssel geleert.
 */
const LS_KEY = "musiclist-music-db-files-v1";
const LS_KEY_LEGACY = "easy-gema-music-db-files-v1";

/** Persistierte Liste bekannter MP3-Dateinamen (kumulativ über alle EDLs). */
export function loadMusicDatabaseFileNames(): string[] {
  try {
    let raw = localStorage.getItem(LS_KEY);
    if (!raw) {
      const old = localStorage.getItem(LS_KEY_LEGACY);
      if (old) {
        localStorage.setItem(LS_KEY, old);
        localStorage.removeItem(LS_KEY_LEGACY);
        raw = old;
      }
    }
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  } catch {
    return [];
  }
}

export function saveMusicDatabaseFileNames(names: string[]): void {
  try {
    const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, "de")
    );
    localStorage.setItem(LS_KEY, JSON.stringify(unique));
  } catch {
    /* Quota */
  }
}
