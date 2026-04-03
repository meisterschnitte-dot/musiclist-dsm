import { stripExtension } from "./tracks/sanitizeFilename";

export const P7S1_MUSIKPORTAL_TRACK_RESEARCH_URL =
  "https://musikportal.p7s1.net/Pages/TrackResearch.aspx";

/** Aus Dateiname (Songtitel): Stamm ohne Endung, bis zum ersten Unterstrich — für P7S1-Zwischenablage. */
export function clipP7SearchPrefixFromTrackFilename(fileName: string): string {
  const stem = stripExtension(fileName).trim();
  const i = stem.indexOf("_");
  if (i === -1) return stem;
  return stem.slice(0, i);
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
