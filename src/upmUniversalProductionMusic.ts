import { basenamePath } from "./tracks/sanitizeFilename";

export const UPM_SEARCH_URL = "https://www.universalproductionmusic.com/de-de/search";

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
 * Aus einem UPM-Dateinamen (z. B. `UPM_ESW2878_17_…`): alles direkt nach `UPM_` bis vor dem
 * zweiten Unterstrich im Rest — z. B. `ESW2878_17`.
 * Nur der Dateiname (ohne Ordnerpfad), sonst schlägt die Erkennung bei `ordner/UPM_…` fehl.
 */
export function clipUpmCatalogFromFilename(fileName: string): string | null {
  const base = basenamePath(fileName).trim();
  const stem = stripTrailingAudioExtensions(base).trim();
  const m = /^UPM_/i.exec(stem);
  if (!m) return null;
  const rest = stem.slice(m[0].length);
  if (!rest) return null;
  const u1 = rest.indexOf("_");
  if (u1 === -1) return rest;
  const u2 = rest.indexOf("_", u1 + 1);
  if (u2 === -1) return rest;
  return rest.slice(0, u2);
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
 * Kopiert den Katalog-String, öffnet die UPM-Suche.
 * Zwischenablage zuerst per Clipboard-API (await), danach neues Fenster — so bleibt die User-Geste gültig.
 */
export async function openUpmSearchWithOptionalClipAsync(
  sourceFileNameOrTitle: string | null | undefined
): Promise<void> {
  const t = sourceFileNameOrTitle?.trim();
  const clip = t ? clipUpmCatalogFromFilename(t) : null;
  const url = clip
    ? `${UPM_SEARCH_URL}?searchString=${encodeURIComponent(clip)}`
    : UPM_SEARCH_URL;
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

export function openUpmSearchWithOptionalClip(sourceFileNameOrTitle: string | null | undefined): void {
  void openUpmSearchWithOptionalClipAsync(sourceFileNameOrTitle);
}
