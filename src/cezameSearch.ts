import { basenamePath } from "./tracks/sanitizeFilename";

export const CEZAME_DE_URL = "https://de.cezamemusic.com/";

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
 * Cézame-Trackcode: Zeichenkette **zwischen** dem ersten und dem zweiten Unterstrich
 * im Dateinamen (ohne Pfad, ohne Audio-Endung), z. B. `A_B_C` → `B`.
 */
export function clipCezameTrackCodeFromFilename(fileName: string): string | null {
  const base = basenamePath(fileName).trim();
  if (!base) return null;
  const stem = stripTrailingAudioExtensions(base).trim();
  const i1 = stem.indexOf("_");
  if (i1 === -1) return null;
  const i2 = stem.indexOf("_", i1 + 1);
  if (i2 === -1) return null;
  const code = stem.slice(i1 + 1, i2).trim();
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
 * Trackcode in die Zwischenablage, Cézame (DE) in neuem Tab.
 * Kein URL-Parameter (Suchseite) — in der Suche manuell einfügen (Strg+V / ⌘V), siehe Titel-Tooltip.
 */
export async function openCezameSearchWithOptionalClipAsync(
  sourceFileNameOrTitle: string | null | undefined
): Promise<void> {
  const t = sourceFileNameOrTitle?.trim();
  const clip = t ? clipCezameTrackCodeFromFilename(t) : null;
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
  window.open(CEZAME_DE_URL, "_blank", "noopener,noreferrer");
}
