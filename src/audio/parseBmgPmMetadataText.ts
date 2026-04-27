import type { AudioTags } from "./audioTags";
import type { ParseGemaOcrResult } from "./parseGemaOcrText";

/** Wert vor einem optionalen „ = Hinweis“ (z. B. deutsche Anmerkung). */
function valueBeforeEqualsNote(rest: string): string {
  const t = rest.trim();
  const eq = t.indexOf(" = ");
  if (eq === -1) return t;
  return t.slice(0, eq).trim();
}

/** Entfernt Anteils-Prozente und (PRS)-Kürzel grob für Komponisten-Zeile. */
function cleanComposerLine(s: string): string {
  return s
    .replace(/\s*\([^)]*\)\s*\d{1,3}\.?\d*\s*%/gi, "")
    .replace(/\s*\d{1,3}\.?\d*\s*%/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseLine(line: string): { key: string; rawValue: string } | null {
  const idx = line.indexOf(":");
  if (idx <= 0) return null;
  const key = line.slice(0, idx).trim().toLowerCase();
  const rawValue = line.slice(idx + 1).trim();
  if (!key) return null;
  return { key, rawValue };
}

/**
 * Erkennt BMG-Portal-Metadaten (z. B. aus der Zwischenablage nach „Track ansehen“).
 */
export function looksLikeBmgPmMetadata(text: string): boolean {
  const t = text.trim();
  if (t.length < 40) return false;
  if (
    /label\s*:/i.test(t) &&
    /album\s+code\s*:/i.test(t) &&
    /track\s+title\s*:/i.test(t) &&
    /isrc\s*:/i.test(t)
  ) {
    return true;
  }
  return (
    /album\s+code\s*:/i.test(t) &&
    /track\s+title\s*:/i.test(t) &&
    (/publisher\s*:/i.test(t) || /artist\s*\(s\)\s*:/i.test(t))
  );
}

/**
 * Mappt BMG-Zeilen auf AudioTags. „Label:“ füllt das Label-Feld — für GVL-Abgleich (Labelcode fehlt im Portal oft).
 */
export function parseBmgPmMetadataText(raw: string): ParseGemaOcrResult {
  const lines = raw.split(/\r?\n/).map((l) => l.trim());
  let albumCode = "";
  let albumTitle = "";
  const fields: Partial<AudioTags> = {};
  const extraCommentLines: string[] = [];

  for (const line of lines) {
    if (!line) continue;
    const p = parseLine(line);
    if (!p) {
      extraCommentLines.push(line);
      continue;
    }
    const { key, rawValue } = p;
    const val = valueBeforeEqualsNote(rawValue);

    if (key === "label") {
      const lab = val.replace(/\s+/g, " ").trim();
      if (lab) fields.label = lab;
      continue;
    }
    if (key === "album code") {
      albumCode = val;
      continue;
    }
    if (key === "album title") {
      albumTitle = val;
      continue;
    }
    if (key === "release date") {
      const y = val.match(/\b(19|20)\d{2}\b/);
      if (y) fields.year = y[0];
      continue;
    }
    if (key === "track #") {
      extraCommentLines.push(`Track #: ${val}`);
      continue;
    }
    if (key === "file name") {
      continue;
    }
    if (key === "track title") {
      fields.songTitle = val;
      continue;
    }
    if (key === "track version") {
      extraCommentLines.push(`Track Version: ${val}`);
      continue;
    }
    if (key === "duration") {
      extraCommentLines.push(`Duration: ${val}`);
      continue;
    }
    if (key === "artist(s)" || key === "artist") {
      fields.artist = val;
      continue;
    }
    if (key === "composer(s)" || key === "composer") {
      fields.composer = cleanComposerLine(val);
      continue;
    }
    if (key === "publisher") {
      fields.hersteller = valueBeforeEqualsNote(rawValue)
        .replace(/\s*\d{1,3}\.?\d*\s*%?\s*$/g, "")
        .replace(/\s*\(PRS\)\s*/gi, " ")
        .trim();
      continue;
    }
    if (key === "isrc") {
      fields.isrc = val.replace(/\s+/g, "").trim();
      continue;
    }
    extraCommentLines.push(line);
  }

  if (albumCode && albumTitle) {
    fields.album = `${albumCode} ${albumTitle}`.trim();
  } else if (albumTitle) {
    fields.album = albumTitle;
  } else if (albumCode) {
    fields.album = albumCode;
  }

  return { fields, extraCommentLines };
}
