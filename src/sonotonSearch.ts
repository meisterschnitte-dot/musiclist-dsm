import { stripExtension } from "./tracks/sanitizeFilename";

/** Bisherige Sonoton-Websuche (direkter Link, z. B. in Verwaltung → Musikverlage). */
export const SONOTON_SEARCH_BASE_URL = "https://sonoton.com/de/search/";

/**
 * Öffentliches MMD-XML: [SonoFind](https://www.sonofind.com/mmd/) — s. [musicmetadata.org](https://musicmetadata.org).  
 * Im Tag-Editor werden Daten per `/api/sonofind/mmd` geladen, nicht im Tab geöffnet.
 */
export const SONOTON_MMD_BASE_URL = "https://www.sonofind.com/mmd/";

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

function isIsrcLikeToken(s: string): boolean {
  return (
    /^[A-Z]{2}-[A-Z0-9]{3}-\d{2}-\d+$/i.test(s) ||
    /^[A-Z]{2}[A-Z0-9]{3}\d{2}\d{4,}$/i.test(s)
  );
}

/**
 * Plausibler SonoFind-/MMD-`trackcode`:
 * - mit Bindestrich, z. B. `AB-C032633` / `AB-27473893`,
 * - oder ohne Bindestrich (erstes `_`-Segment o. ä.), z. B. `sk8463637464` (Buchstaben, dann u. a. Ziffern).
 */
function isPlausibleMmdTrackCode(s: string): boolean {
  const t = s.trim();
  if (t.length < 7 || t.length > 32) return false;
  if (isIsrcLikeToken(t)) return false;
  if (/^\d{4}-/.test(t)) return false;
  if (t.indexOf("-") >= 0) {
    if (!/^[A-Z0-9][A-Z0-9-]*[0-9]+$/i.test(t)) return false;
    return true;
  }
  if (!/^[A-Za-z]{2,}[A-Z0-9]*\d+$/i.test(t)) return false;
  return true;
}

/**
 * SonoFind-Trackcode aus dem Dateinamen: typisch **ein `_`-getrennter** Block (Kennung bis zum
 * nächsten Unterstrich) — `AB-27473893` / `AB-C032633` **oder** ohne Bindestrich, z. B. `sk8463637464`.
 */
export function extractSonoFindMmdTrackcodeFromFilename(fileName: string): string | null {
  const stem = stripExtension(fileName).trim();
  const sep = firstPathSeparatorIndex(stem);
  let afterSep = (sep === -1 ? stem : stem.slice(sep + 1)).replace(/^\d{1,4}_/, "");
  if (!afterSep) return null;

  const byUnderscore = afterSep
    .split(/_+/)
    .map((x) => x.trim())
    .filter(Boolean);
  for (const t of byUnderscore) {
    if (isPlausibleMmdTrackCode(t)) return t;
  }

  const bySplit = afterSep
    .split(/[^A-Z0-9-]+/i)
    .map((x) => x.trim())
    .filter(Boolean);

  let best: string | null = null;
  for (const t of bySplit) {
    if (!isPlausibleMmdTrackCode(t)) continue;
    if (!best || t.length > best.length) best = t;
  }
  if (best) return best;

  const prefix = clipSonotonSearchPrefixFromTrackFilename(fileName);
  if (prefix && isPlausibleMmdTrackCode(prefix)) return prefix;
  if (isPlausibleMmdTrackCode(afterSep)) return afterSep;
  return null;
}
