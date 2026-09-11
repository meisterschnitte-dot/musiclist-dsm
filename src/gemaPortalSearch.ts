import { basenamePath } from "./tracks/sanitizeFilename";

/** GEMA Repertoire — Werksuche (Suchfeld: Dateiname einfügen). */
export const GEMA_WERK_SUCHE_URL =
  "https://portal.gema.de/app/repertoiresuche/werksuche";

/** Dateiname ohne Pfad und ohne .mp3/.wav für die GEMA-Suche in die Zwischenablage. */
export function clipGemaWerkSearchFromSource(sourceFileNameOrTitle: string): string {
  const base = basenamePath(sourceFileNameOrTitle.trim().replace(/\\/g, "/"));
  return base.replace(/\.(mp3|wav)$/i, "").trim();
}

export function openGemaPortalWerkSearchWithOptionalClip(
  sourceFileNameOrTitle: string | null | undefined
): void {
  const t = sourceFileNameOrTitle?.trim();
  if (t) {
    const clip = clipGemaWerkSearchFromSource(t);
    if (clip) void navigator.clipboard.writeText(clip).catch(() => {});
  }
  window.open(GEMA_WERK_SUCHE_URL, "_blank", "noopener,noreferrer");
}
