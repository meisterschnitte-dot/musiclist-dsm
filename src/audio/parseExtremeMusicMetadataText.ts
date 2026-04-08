import type { AudioTags } from "./audioTags";
import type { ParseGemaOcrResult } from "./parseGemaOcrText";
import { labelcodeWithLcPrefix } from "../blankframeSearch";

/**
 * Kopiertext von Extreme Music (Title / CAT_ID / Album / Composers / Codes / …).
 */
export function looksLikeExtremeMusicMetadata(text: string): boolean {
  const t = text.trim();
  if (t.length < 25) return false;
  if (!/^title\s*:/im.test(t)) return false;
  let score = 0;
  if (/^codes\s*:/im.test(t) && /\bisrc\s*:/i.test(t)) score += 2;
  if (/^composers\s*:/im.test(t)) score++;
  if (/^album\s*:/im.test(t)) score++;
  if (/^cat_id\s*:/im.test(t)) score++;
  if (/extreme\s+musik|extreme\s+music/i.test(t)) score++;
  return score >= 2;
}

function stripTrailingRoleHint(rest: string): string {
  const t = rest.trim();
  const m = /^(.*?)\s*=\s*(Songtitel|Albumtitel|Komponist(?:\s*=\s*Interpret)?|Labelcode)\s*$/i.exec(t);
  if (m) return m[1]!.trim();
  return t;
}

/** BUMA/GEMA-Society-Zusätze und Anteile aus Composers-Zeilen entfernen. */
function normalizeExtremeComposers(raw: string): string {
  const main = raw.split(/\s*=\s*Komponist/i)[0]?.trim() ?? raw.trim();
  if (!main) return "";
  const parts = main.split(/\s*\/\s*/);
  const names = parts
    .map((p) => {
      const beforeSociety = p.split(/,\s*(BUMA|GEMA|PRS)\s*:/i)[0]?.trim() ?? p.trim();
      return beforeSociety.replace(/,\s*\d+%\s*$/i, "").trim();
    })
    .filter(Boolean);
  return names.join("; ");
}

function stripPublisherSocietyTail(s: string): string {
  return s
    .replace(/,\s*(GEMA|PRS|BUMA)\s*:\s*[^,]+(?:,\s*\d+%)?/gi, "")
    .replace(/,\s*\d+%\s*$/i, "")
    .trim();
}

function parseCodesLine(rest: string, fields: Partial<AudioTags>, extra: string[]): void {
  const t = rest.trim();
  const isrcM = /\bISRC\s*:\s*([A-Z0-9]{10,15})/i.exec(t);
  if (isrcM) fields.isrc = isrcM[1]!.replace(/\s+/g, "").trim();

  const lcM = /\bLC\s*:\s*(\d+)/i.exec(t);
  if (lcM) {
    const lc = labelcodeWithLcPrefix(lcM[1]!);
    if (lc) fields.labelcode = lc;
  }

  const tempoM = /\bTEMPO\s+CODE\s*:\s*(\d+)/i.exec(t);
  if (tempoM) extra.push(`TEMPO CODE: ${tempoM[1]}`);
}

/**
 * Mappt Extreme-Music-Zeilientext auf AudioTags.
 */
export function parseExtremeMusicMetadataText(raw: string): ParseGemaOcrResult {
  const lines = raw.split(/\r?\n/);
  const fields: Partial<AudioTags> = {};
  const extraCommentLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const colon = trimmed.indexOf(":");
    if (colon <= 0) {
      extraCommentLines.push(trimmed);
      continue;
    }

    const keyRaw = trimmed.slice(0, colon).trim().toLowerCase().replace(/\s+/g, "_");
    let value = trimmed.slice(colon + 1).trim();

    if (keyRaw === "title" || keyRaw === "titel") {
      value = stripTrailingRoleHint(value);
      if (value) fields.songTitle = value;
      continue;
    }
    if (keyRaw === "cat_id") {
      extraCommentLines.push(`CAT_ID: ${value}`);
      continue;
    }
    if (keyRaw === "album") {
      value = stripTrailingRoleHint(value);
      if (value) fields.album = value;
      continue;
    }
    if (keyRaw === "composers") {
      const names = normalizeExtremeComposers(value);
      if (names) {
        fields.composer = names;
        fields.artist = names;
      }
      continue;
    }
    if (keyRaw === "collecting_publisher") {
      const v = stripPublisherSocietyTail(value);
      if (v) fields.label = v;
      continue;
    }
    if (keyRaw === "codes") {
      parseCodesLine(value, fields, extraCommentLines);
      continue;
    }
    if (keyRaw === "original_publisher") {
      const v = stripPublisherSocietyTail(value);
      if (v) fields.hersteller = v;
      continue;
    }

    extraCommentLines.push(trimmed);
  }

  return { fields, extraCommentLines };
}
