import { basenamePath } from "./tracks/sanitizeFilename";

export const EXTREME_MUSIC_URL = "https://www.extrememusic.com/";

/**
 * Suchcode für Extreme Music: erster „Token“ bis zur ersten Leerzeile (z. B. aus dem Dateinamen).
 * Beispiel: `XXL025_26 - WOW …` → `XXL025_26`
 */
export function clipExtremeSearchCodeFromSource(source: string | null | undefined): string {
  const t = source?.trim() ?? "";
  if (!t) return "";
  const base = basenamePath(t);
  const firstLine = base.split(/\r?\n/)[0] ?? base;
  const sp = firstLine.search(/\s/);
  const segment = sp === -1 ? firstLine : firstLine.slice(0, sp);
  return segment.trim();
}

/**
 * Kopiert den Code in die Zwischenablage und öffnet [Extreme Music](https://www.extrememusic.com/).
 */
export function openExtremeMusicSearchWithOptionalClip(sourceFileNameOrTitle: string | null | undefined): void {
  const t = sourceFileNameOrTitle?.trim();
  if (t) {
    const text = clipExtremeSearchCodeFromSource(t);
    void navigator.clipboard.writeText(text).catch(() => {});
  }
  window.open(EXTREME_MUSIC_URL, "extreme_music_musiclist", "noopener,noreferrer");
}
