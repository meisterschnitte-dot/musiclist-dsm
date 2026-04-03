import { basenamePath, stripExtension } from "./tracks/sanitizeFilename";

export const APPLE_MUSIC_SEARCH_URL = "https://music.apple.com/de/search";

/**
 * Fokus wie bei der UI: nicht den ganzen Pfad — zuerst alles nach dem ersten „/“,
 * dann nur noch der Dateiname (letztes Segment), falls noch Ordner dabei sind.
 * Ohne „/“ im String (z. B. Windows-Pfade): nur der Dateiname (ohne führende Ordner).
 */
function appleSearchFocusFileStem(pathOrFileName: string): string {
  let s = pathOrFileName.trim();
  if (s.includes("/")) {
    s = s.slice(s.indexOf("/") + 1);
  }
  s = basenamePath(s);
  return stripExtension(s).trim();
}

/**
 * Aus diesem Stamm: mit Unterstrich → alles nach dem ersten _, Bindestriche/Unterstriche → Leerzeichen
 * (z. B. RHOBH_A-BEAUTY → „A BEAUTY …“). Ohne Unterstrich → gesamter Stamm nach dem „/“-Fokus,
 * ebenfalls ohne Bindestriche/Unterstriche (nur Leerzeichen).
 */
export function clipAppleSearchTermFromTrackFilename(pathOrFileName: string): string {
  const stem = appleSearchFocusFileStem(pathOrFileName);
  const i = stem.indexOf("_");
  const raw = i === -1 ? stem : stem.slice(i + 1);
  return raw.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Öffnet Apple Music (Suche); Suchbegriff und Zwischenablage wie oben aus dem Dateinamen.
 */
export function openAppleMusicWithOptionalClip(sourceFileNameOrTitle: string | null | undefined): void {
  const t = sourceFileNameOrTitle?.trim();
  const term = t ? clipAppleSearchTermFromTrackFilename(t) : "";
  const url = term
    ? `${APPLE_MUSIC_SEARCH_URL}?term=${encodeURIComponent(term)}`
    : APPLE_MUSIC_SEARCH_URL;
  if (term) {
    void navigator.clipboard.writeText(term).catch(() => {});
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
