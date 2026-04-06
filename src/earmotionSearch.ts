import { basenamePath, stripExtension } from "./tracks/sanitizeFilename";

export const EARMOTION_ACCOUNT_URL = "https://www.earmotion-library.de/account.php";

/** Entfernt abschließendes `.mp3` / `.wav` (für Zwischenablage-Suche). */
function stripTrailingMp3Wav(s: string): string {
  return s.replace(/\.(mp3|wav)\s*$/i, "").trim();
}

/**
 * Suchtext für Earmotion: Dateiname ohne Pfad. Am Stamm (ohne Extension) wird nach „- EARMOTION“
 * gesucht — der Teil davor wird verwendet. Ohne diesen Marker: vollständiger Dateiname; `.mp3`/`.wav`
 * werden nicht mitkopiert.
 */
export function clipEarmotionSearchPrefixFromTrackFilename(fileName: string): string {
  const base = basenamePath(fileName.trim()).trim();
  if (!base) return "";
  const stem = stripExtension(base).trim();
  const m = /\s*-\s*EARMOTION\b/i.exec(stem);
  if (!m) return stripTrailingMp3Wav(base);
  return stripTrailingMp3Wav(stem.slice(0, m.index).trim());
}

/**
 * Kopiert den Präfix-Text in die Zwischenablage und öffnet die Earmotion-Account-Seite.
 * Fremde Seiten erlauben kein programmatisches Einfügen — dort Strg+V / ⌘V ins Suchfeld.
 */
export function openEarmotionSearchWithOptionalClip(sourceFileNameOrTitle: string | null | undefined): void {
  const t = sourceFileNameOrTitle?.trim();
  if (t) {
    const text = clipEarmotionSearchPrefixFromTrackFilename(t);
    void navigator.clipboard.writeText(text).catch(() => {});
  }
  window.open(EARMOTION_ACCOUNT_URL, "_blank", "noopener,noreferrer");
}
