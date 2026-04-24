import { basenamePath } from "./tracks/sanitizeFilename";

export const AUDIONETWORK_DE_SEARCH_URL = "https://de.audionetwork.com/track/searchkeyword";

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
 * Audio-Network-Trackcode: Zeichenkette am **Anfang** des Dateinamens (ohne Ordner, ohne
 * Audio-Endung) **bis vor dem ersten** Unterstrich, z. B. `ANW3920_…` → `ANW3920`.
 */
export function clipAudioNetworkTrackCodeFromFilename(fileName: string): string | null {
  const base = basenamePath(fileName).trim();
  if (!base) return null;
  const stem = stripTrailingAudioExtensions(base).trim();
  if (!stem) return null;
  const u = stem.indexOf("_");
  if (u === -1) return null;
  const code = stem.slice(0, u).trim();
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
 * Trackcode in die Zwischenablage, Suche in neuem Tab.
 * (Suchfeld-Vorbefüllung: die Seite wertet keine stabile ?-Param-Logik; bei Bedarf Strg+V.)
 */
export async function openAudioNetworkSearchWithOptionalClipAsync(
  sourceFileNameOrTitle: string | null | undefined
): Promise<void> {
  const t = sourceFileNameOrTitle?.trim();
  const clip = t ? clipAudioNetworkTrackCodeFromFilename(t) : null;
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
  window.open(AUDIONETWORK_DE_SEARCH_URL, "_blank", "noopener,noreferrer");
}
