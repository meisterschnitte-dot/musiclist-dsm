import { basenamePath } from "./tracks/sanitizeFilename";

export const BIBLIOTHEQUE_MUSIC_URL = "https://bibliothequemusic.com/";

function stripTrailingAudioExtensions(name: string): string {
  let s = name;
  for (;;) {
    const l = s.toLowerCase();
    let cut: string | null = null;
    for (const ext of [".mp3", ".wav", ".aiff", ".aif", ".flac", ".m4a", ".ogg"]) {
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
 * Optional: erster `:` trennt Präfix; im Rest wie Cézame: **zwischen** dem ersten und zweiten `_`.
 * Ohne Doppelpunkt: ganzer Stamm, zwischen erstem und zweitem Unterstrich.
 */
export function clipBibliothequeTrackCodeFromFilename(fileName: string): string | null {
  const base = basenamePath(fileName).trim();
  if (!base) return null;
  const stem = stripTrailingAudioExtensions(base).trim();
  const colon = stem.indexOf(":");
  const segment = colon >= 0 ? stem.slice(colon + 1) : stem;
  if (!segment) return null;
  const i1 = segment.indexOf("_");
  if (i1 === -1) return null;
  const i2 = segment.indexOf("_", i1 + 1);
  if (i2 === -1) {
    return segment.slice(i1 + 1).trim() || null;
  }
  const code = segment.slice(i1 + 1, i2).trim();
  return code.length > 0 ? code : null;
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
 * Zwischenablage, ggf. mit Such-Query (externe Seite unbekannt, kann ignoriert werden).
 */
export async function openBibliothequeMusicWithOptionalClipAsync(
  sourceFileNameOrTitle: string | null | undefined
): Promise<void> {
  const t = sourceFileNameOrTitle?.trim();
  const clip = t ? clipBibliothequeTrackCodeFromFilename(t) : null;
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
  const url = clip
    ? `${BIBLIOTHEQUE_MUSIC_URL}?q=${encodeURIComponent(clip)}`
    : BIBLIOTHEQUE_MUSIC_URL;
  window.open(url, "_blank", "noopener,noreferrer");
}
