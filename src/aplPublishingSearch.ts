import { basenamePath } from "./tracks/sanitizeFilename";

export const APL_PUBLISHING_URL = "https://aplpublishing.com/de/";

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
 * Nach dem ersten Unterstrich: typisch `APL 517_…` — Suchbegriff nur `APL 517` (Leerzeichen, Ziffern).
 */
export function clipAplSearchFromFilename(fileName: string): string | null {
  const base = basenamePath(fileName).trim();
  const stem = stripTrailingAudioExtensions(base).trim();
  const u1 = stem.indexOf("_");
  if (u1 === -1) return null;
  const after = stem.slice(u1 + 1);
  const m = /^APL\s+(\d+)/i.exec(after);
  if (!m) return null;
  return `APL ${m[1]}`;
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
 * Kopiert z. B. `APL 517` in die Zwischenablage, öffnet APL Publishing (DE).
 * Wie UPM: zuerst Clipboard, dann neues Fenster (User-Geste).
 */
export async function openAplPublishingSearchWithOptionalClipAsync(
  sourceFileNameOrTitle: string | null | undefined
): Promise<void> {
  const t = sourceFileNameOrTitle?.trim();
  const clip = t ? clipAplSearchFromFilename(t) : null;
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
  window.open(APL_PUBLISHING_URL, "_blank", "noopener,noreferrer");
}
