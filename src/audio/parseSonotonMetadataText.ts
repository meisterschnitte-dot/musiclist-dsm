import type { AudioTags } from "./audioTags";
import type { ParseGemaOcrResult } from "./parseGemaOcrText";

/** Wert vor einem optionalen „ = Hinweis“ (z. B. „= Songtitel“). */
function valueBeforeEqualsNote(rest: string): string {
  const t = rest.trim();
  const eq = t.indexOf(" = ");
  if (eq === -1) return t;
  return t.slice(0, eq).trim();
}

/** Labelcode-Zeile: „LC 07573“ (LC, Leerzeichen, Ziffern; Eingaben wie LC-07573 oder nur Ziffern). */
function normalizeLabelcodeLc(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  return `LC ${digits}`;
}

/**
 * Erkennt Sonoton-Portal-/Such-Metadaten (Zwischenablage, mehrzeilig „Schlüssel: Wert“).
 */
export function looksLikeSonotonMetadata(text: string): boolean {
  const t = text.trim();
  if (t.length < 30) return false;
  const hasTrackcode = /sonoton\s+music\s+trackcode/i.test(t);
  const hasMusiktitel = /musiktitel\s*:/i.test(t);
  const hasKatalog = /katalognummer\s*:/i.test(t);
  const hasLabelcodeLine = /labelcode\s*:/i.test(t);
  const sonotonHint = /\bsonoton\b/i.test(t);
  if (hasTrackcode && hasMusiktitel) return true;
  if (hasMusiktitel && hasKatalog && hasLabelcodeLine) return true;
  if (hasMusiktitel && hasLabelcodeLine && sonotonHint) return true;
  return false;
}

/**
 * Mappt Sonoton-Zeilen auf AudioTags. Nicht gemappte Zeilen (Trackcode, GEMA-Werk, EAN, …) landen in extraCommentLines.
 */
export function parseSonotonMetadataText(raw: string): ParseGemaOcrResult {
  const lines = raw.split(/\r?\n/).map((l) => l.trim());
  const fields: Partial<AudioTags> = {};
  const extraCommentLines: string[] = [];

  for (const line of lines) {
    if (!line) continue;

    const idx = line.indexOf(":");
    if (idx <= 0) {
      extraCommentLines.push(line);
      continue;
    }

    const keyRaw = line.slice(0, idx).trim().toLowerCase().replace(/\s+/g, " ");
    const value = valueBeforeEqualsNote(line.slice(idx + 1));

    if (!value) continue;

    if (keyRaw === "musiktitel") {
      if (value) fields.songTitle = value;
      continue;
    }
    if (keyRaw === "sonoton music trackcode") {
      if (value) extraCommentLines.push(`Sonoton Trackcode: ${value}`);
      continue;
    }
    if (keyRaw === "katalognummer") {
      if (value) extraCommentLines.push(`Katalognummer: ${value}`);
      continue;
    }
    if (
      keyRaw === "track nummer" ||
      keyRaw === "tracknummer" ||
      keyRaw === "track-nr" ||
      keyRaw === "track nr"
    ) {
      if (value) extraCommentLines.push(`Track-Nr.: ${value}`);
      continue;
    }
    if (keyRaw === "gema werke nr." || keyRaw === "gema werke nr" || keyRaw === "gema-werke-nr") {
      if (value) extraCommentLines.push(`GEMA-Werk: ${value}`);
      continue;
    }
    if (keyRaw === "gema komponistenangabe") {
      if (value) extraCommentLines.push(`GEMA Komponistenangabe: ${value}`);
      continue;
    }
    if (keyRaw === "komponist") {
      if (value) fields.composer = value;
      continue;
    }
    if (keyRaw === "interpreten" || keyRaw === "interpret" || keyRaw === "interpret(en)") {
      if (value) fields.artist = value;
      continue;
    }
    if (keyRaw === "isrc") {
      if (value) fields.isrc = value.replace(/\s+/g, "").trim();
      continue;
    }
    if (keyRaw === "ean/gtin" || keyRaw === "ean" || keyRaw === "gtin") {
      if (value) extraCommentLines.push(`EAN/GTIN: ${value}`);
      continue;
    }
    if (keyRaw === "album") {
      if (value) fields.album = value;
      continue;
    }
    if (keyRaw === "labelcode") {
      const lc = normalizeLabelcodeLc(value);
      if (lc) fields.labelcode = lc;
      continue;
    }
    if (keyRaw === "label") {
      if (value) fields.label = value;
      continue;
    }

    extraCommentLines.push(line);
  }

  return { fields, extraCommentLines };
}
