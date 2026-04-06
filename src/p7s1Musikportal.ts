import { stripExtension } from "./tracks/sanitizeFilename";

export const P7S1_MUSIKPORTAL_TRACK_RESEARCH_URL =
  "https://musikportal.p7s1.net/Pages/TrackResearch.aspx";

/** Erster Pfadtrenner `/` oder `\` (welcher zuerst vorkommt). */
function firstPathSeparatorIndex(s: string): number {
  const f = s.indexOf("/");
  const b = s.indexOf("\\");
  if (f === -1) return b;
  if (b === -1) return f;
  return Math.min(f, b);
}

/**
 * Suchbegriff für P7S1-Zwischenablage: nach dem ersten Pfadtrenner (`/` oder `\`)
 * bis zum ersten Unterstrich (ohne den Unterstrich und den Rest).
 * Ohne Pfadtrenner wie bisher: ganzer Stamm bis zum ersten `_`.
 */
export function clipP7SearchPrefixFromTrackFilename(fileName: string): string {
  const stem = stripExtension(fileName).trim();
  const sep = firstPathSeparatorIndex(stem);
  const afterSep = sep === -1 ? stem : stem.slice(sep + 1);
  const u = afterSep.indexOf("_");
  if (u === -1) return afterSep;
  return afterSep.slice(0, u);
}

/** Öffnet das P7S1 Track Research; kopiert optional den Suchpräfix aus Dateiname/Titel. */
export function openP7S1MusikportalWithOptionalClip(sourceFileNameOrTitle: string | null | undefined): void {
  const t = sourceFileNameOrTitle?.trim();
  if (t) {
    const prefix = clipP7SearchPrefixFromTrackFilename(t);
    void navigator.clipboard.writeText(prefix).catch(() => {});
  }
  window.open(P7S1_MUSIKPORTAL_TRACK_RESEARCH_URL, "_blank", "noopener,noreferrer");
}
