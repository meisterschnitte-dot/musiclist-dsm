import { basenamePath } from "./tracks/sanitizeFilename";

export const BMGPM_SEARCH_URL = "https://bmgproductionmusic.com/de-de/search";

/** Entfernt typische Audio-Endungen (auch gestapelt: `.wav.mp3`). */
function stripTrailingAudioExtensions(name: string): string {
  let s = name;
  for (;;) {
    const l = s.toLowerCase();
    let cut: string | null = null;
    for (const ext of [".mp3", ".wav", ".aiff", ".aif", ".flac", ".m4a"]) {
      if (l.endsWith(ext)) {
        cut = ext;
        break;
      }
    }
    if (!cut) break;
    s = s.slice(0, -cut.length);
  }
  return s;
}

/**
 * Aus einem BMGPM-Dateinamen (z. B. `BMGPM_LKY0123_023_RISE_UP_30_…`):
 * Katalogteil nach dem ersten Unterstrich (`LKY0123`) + Leerzeichen + erstes Wort des Songtitels
 * (Segment nach dem dritten Unterstrich, z. B. `RISE`) → `LKY0123 RISE`.
 */
export function clipBmgPmSearchFromFilename(fileName: string): string | null {
  const base = basenamePath(fileName).trim();
  const stem = stripTrailingAudioExtensions(base).trim();
  if (!/^BMGPM_/i.test(stem)) return null;
  const parts = stem.split("_");
  if (parts.length < 4) return null;
  if (!/^BMGPM$/i.test(parts[0] ?? "")) return null;
  const catalog = parts[1]?.trim();
  const titleFirst = parts[3]?.trim();
  if (!catalog || !titleFirst) return null;
  return `${catalog} ${titleFirst}`;
}

function copyTextToClipboardSync(text: string): boolean {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "0";
    ta.style.top = "0";
    ta.style.opacity = "0";
    ta.style.pointerEvents = "none";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Kopiert den Suchstring, öffnet die BMG Production Music Suche.
 * Gleiche Reihenfolge wie UPM: Zwischenablage zuerst, dann neues Fenster.
 */
export async function openBmgPmSearchWithOptionalClipAsync(
  sourceFileNameOrTitle: string | null | undefined
): Promise<void> {
  const t = sourceFileNameOrTitle?.trim();
  const clip = t ? clipBmgPmSearchFromFilename(t) : null;
  const url = clip
    ? `${BMGPM_SEARCH_URL}?searchString=${encodeURIComponent(clip)}`
    : BMGPM_SEARCH_URL;
  if (clip) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(clip);
      } else {
        copyTextToClipboardSync(clip);
      }
    } catch {
      copyTextToClipboardSync(clip);
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
