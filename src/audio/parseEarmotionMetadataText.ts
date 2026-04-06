import type { AudioTags } from "./audioTags";
import type { ParseGemaOcrResult } from "./parseGemaOcrText";

/**
 * Wert vor „ = Hinweis“ oder vor „=Albumtitel“ / „=Labelcode“ am Zeilenende
 * (auch ohne Leerzeichen vor dem zweiten `=`).
 */
function valueBeforeTrailingHint(rest: string): string {
  const t = rest.trim();
  const m =
    /^(.*?)\s*=\s*(Songtitel|Albumtitel|Hersteller|Komponist(?:\s+und\s+Interpret)?|Labelcode)\s*$/i.exec(t);
  if (m) return m[1]!.trim();
  const spaced = t.indexOf(" = ");
  if (spaced !== -1) return t.slice(0, spaced).trim();
  return t;
}

/** Nach Entfernen von „LC“/Leerzeichen am Anfang: normiert zu „LC 12345“. */
function normalizeLabelcodeFromLcValue(raw: string): string {
  let s = raw.trim().replace(/^LC[\s:-]*/i, "").trim();
  const digits = s.replace(/\D/g, "");
  if (!digits) return "";
  return `LC ${digits}`;
}

/**
 * Erkennt Earmotion-/Portal-Kopiertext (z. B. „… = Songtitel“, Verlag, LC, …).
 */
export function looksLikeEarmotionMetadata(text: string): boolean {
  const t = text.trim();
  if (t.length < 35) return false;
  if (!/\bearmotion\b/i.test(t)) return false;
  let score = 0;
  if (/komponist\s*:/i.test(t)) score++;
  if (/verlag\s*:/i.test(t)) score++;
  if (/=\s*Songtitel\b/i.test(t)) score++;
  if (/album\s*:/i.test(t)) score++;
  if (/^lc\s*:/im.test(t)) score++;
  if (/label\s*:/i.test(t)) score++;
  return score >= 2;
}

/**
 * Mappt Earmotion-Zeilientext auf AudioTags.
 */
export function parseEarmotionMetadataText(raw: string): ParseGemaOcrResult {
  const lines = raw.split(/\r?\n/).map((l) => l.trim());
  const fields: Partial<AudioTags> = {};
  const extraCommentLines: string[] = [];

  for (const line of lines) {
    if (!line) continue;

    const songLine = /^(.+?)\s*=\s*Songtitel\s*$/i.exec(line);
    if (songLine) {
      const t = songLine[1]!.trim();
      if (t) fields.songTitle = t;
      continue;
    }

    const idx = line.indexOf(":");
    if (idx <= 0) {
      extraCommentLines.push(line);
      continue;
    }

    const keyRaw = line.slice(0, idx).trim().toLowerCase().replace(/\s+/g, " ");
    let value = valueBeforeTrailingHint(line.slice(idx + 1));
    if (!value) continue;

    if (keyRaw === "komponist") {
      fields.composer = value;
      fields.artist = value;
      continue;
    }
    if (keyRaw === "verlag") {
      fields.hersteller = value;
      continue;
    }
    if (keyRaw === "album") {
      fields.album = value;
      continue;
    }
    if (keyRaw === "label") {
      fields.label = value;
      continue;
    }
    if (keyRaw === "lc") {
      const lc = normalizeLabelcodeFromLcValue(value);
      if (lc) fields.labelcode = lc;
      continue;
    }
    if (keyRaw === "katalognummer") {
      extraCommentLines.push(`Katalognummer: ${value}`);
      continue;
    }
    if (keyRaw === "isrc") {
      fields.isrc = value.replace(/\s+/g, "").trim();
      continue;
    }
    if (keyRaw === "gema werksnummer" || keyRaw === "gema-werksnummer") {
      extraCommentLines.push(`GEMA-Werk: ${value}`);
      continue;
    }

    extraCommentLines.push(line);
  }

  return { fields, extraCommentLines };
}
