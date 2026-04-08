import { basenamePath, stripExtension } from "./tracks/sanitizeFilename";

export const BLANKFRAME_URL = "https://www.blankframe.com/";

/** Fester Blankframe-Labelcode für GVL-Abgleich („LC 95281“). */
export const BLANKFRAME_GVL_LABELCODE_DIGITS = "95281";

/**
 * Findet Katalognummern (z. B. blkfr_0206-3) im Dateinamen oder beliebigem Text — Reihenfolge wie im Text.
 * Immer Kleinbuchstaben: die Blankframe-API liefert bei Großschreibung (z. B. BLKFR_0112-7) keinen Treffer.
 */
export function extractBlankframeCatalogIds(source: string | null | undefined): string[] {
  const t = source ?? "";
  const seen = new Set<string>();
  const out: string[] = [];
  const re = /blkfr_[a-z0-9]+(?:-[a-z0-9]+)*/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    const id = m[0].toLowerCase();
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** Labelcode-Feld: Präfix „LC “ (LC + Leerzeichen), konsistent mit GVL-Übernahme. */
export function labelcodeWithLcPrefix(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  const m = t.match(/^LC\s*(.*)$/i);
  if (m) {
    const rest = m[1]!.trim();
    return rest ? `LC ${rest}` : "LC";
  }
  return `LC ${t}`;
}

/**
 * Suchbegriff für Blankframe: im Dateinamen (ohne Pfad/Endung) der Text ab dem ersten
 * Leerzeichen bis vor dem nächsten Bindestrich (Songtitel-Anteil).
 */
export function clipBlankframeSearchFromTrackFilename(fileName: string): string {
  const stem = stripExtension(basenamePath(fileName)).trim();
  const firstSpace = stem.indexOf(" ");
  if (firstSpace === -1) return "";
  const afterSpace = stem.slice(firstSpace + 1);
  const hyphen = afterSpace.indexOf("-");
  const segment = hyphen === -1 ? afterSpace : afterSpace.slice(0, hyphen);
  return segment.trim();
}

/**
 * Kopiert den Suchbegriff in die Zwischenablage und öffnet [Blankframe](https://www.blankframe.com/).
 * Derselbe Fenstername kann ein bereits geöffnetes Blankframe-Tab wieder verwenden.
 */
export function openBlankframeSearchWithOptionalClip(sourceFileNameOrTitle: string | null | undefined): void {
  const t = sourceFileNameOrTitle?.trim();
  if (t) {
    const q = clipBlankframeSearchFromTrackFilename(t);
    void navigator.clipboard.writeText(q).catch(() => {});
  }
  window.open(BLANKFRAME_URL, "blankframe_musiclist", "noopener,noreferrer");
}
