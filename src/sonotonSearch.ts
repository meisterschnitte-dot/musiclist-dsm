import { stripExtension } from "./tracks/sanitizeFilename";

export const SONOTON_SEARCH_BASE_URL = "https://sonoton.com/de/search/";

/** Erster Pfadtrenner `/` oder `\` (wie P7S1). */
function firstPathSeparatorIndex(s: string): number {
  const f = s.indexOf("/");
  const b = s.indexOf("\\");
  if (f === -1) return b;
  if (b === -1) return f;
  return Math.min(f, b);
}

/**
 * Suchbegriff für Sonoton: wie P7S1 (nach Pfadtrenner, Stamm bis zum ersten `_`),
 * aber eine führende kurze Index-Nummer (1–4 Ziffern + `_`) wird verworfen — der relevante
 * Code steht danach (wieder bis zum ersten `_`).
 */
export function clipSonotonSearchPrefixFromTrackFilename(fileName: string): string {
  const stem = stripExtension(fileName).trim();
  const sep = firstPathSeparatorIndex(stem);
  let afterSep = sep === -1 ? stem : stem.slice(sep + 1);
  afterSep = afterSep.replace(/^\d{1,4}_/, "");
  const u = afterSep.indexOf("_");
  if (u === -1) return afterSep;
  return afterSep.slice(0, u);
}

/**
 * Kopiert den Sonoton-Suchpräfix in die Zwischenablage und öffnet die Suche.
 * Die Website unterstützt `?search=` zur Vorbefüllung des Suchfelds.
 */
export function openSonotonSearchWithOptionalClip(sourceFileNameOrTitle: string | null | undefined): void {
  const t = sourceFileNameOrTitle?.trim();
  let prefix = "";
  if (t) {
    prefix = clipSonotonSearchPrefixFromTrackFilename(t);
    void navigator.clipboard.writeText(prefix).catch(() => {});
  }
  const url =
    prefix.length > 0
      ? `${SONOTON_SEARCH_BASE_URL}?${new URLSearchParams({ search: prefix }).toString()}`
      : SONOTON_SEARCH_BASE_URL;
  window.open(url, "_blank", "noopener,noreferrer");
}
