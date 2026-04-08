import type { AudioTags } from "./audioTags";
import type { ParseGemaOcrResult } from "./parseGemaOcrText";
import { labelcodeWithLcPrefix } from "../blankframeSearch";

/**
 * Blankframe-Kopiertext: Zeilen wie `Dystopia = Songtitel`, optional durch Leerzeilen getrennt;
 * Labelcode auch als Zeile `T-300.027.909-0` ohne `=`.
 */
export function looksLikeBlankframeMetadata(text: string): boolean {
  const t = text.trim();
  if (t.length < 8) return false;
  let score = 0;
  if (/=\s*Songtitel\b/i.test(t)) score++;
  if (/=\s*Albumtitel\b/i.test(t)) score++;
  if (/=\s*Interpret\s+und\s+Komponist/i.test(t)) score++;
  if (/=\s*Labelcode\b/i.test(t)) score++;
  if (/=\s*ISRC\b/i.test(t)) score++;
  if (/^T-[\d.-]+$/im.test(t)) score++;
  return score >= 2 || (score >= 1 && /=\s*(Songtitel|Albumtitel|ISRC)\b/i.test(t));
}

function fieldFromRightSide(right: string): keyof AudioTags | "artistComposer" | null {
  const r = right.trim();
  const lower = r.toLowerCase();
  if (lower.startsWith("songtitel")) return "songTitle";
  if (lower.startsWith("albumtitel")) return "album";
  if (/^interpret\s+und\s+komponist/i.test(r)) return "artistComposer";
  if (lower.startsWith("labelcode")) return "labelcode";
  if (lower.startsWith("isrc")) return "isrc";
  return null;
}

function applyParsedLine(line: string, fields: Partial<AudioTags>): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  const eq = trimmed.indexOf("=");
  if (eq === -1) {
    if (/^T-[\d.-]+$/i.test(trimmed)) {
      fields.labelcode = labelcodeWithLcPrefix(trimmed);
      return true;
    }
    return false;
  }
  const left = trimmed.slice(0, eq).trim();
  const right = trimmed.slice(eq + 1).trim();
  if (!left) return false;
  const key = fieldFromRightSide(right);
  if (!key) return false;
  if (key === "artistComposer") {
    fields.artist = left;
    fields.composer = left;
  } else if (key === "labelcode") {
    fields.labelcode = labelcodeWithLcPrefix(left);
  } else if (key === "songTitle") {
    fields.songTitle = left;
  } else if (key === "album") {
    fields.album = left;
  } else if (key === "isrc") {
    fields.isrc = left;
  }
  return true;
}

export function parseBlankframeMetadataText(raw: string): ParseGemaOcrResult {
  const fields: Partial<AudioTags> = {};
  const extraCommentLines: string[] = [];
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (!applyParsedLine(t, fields)) {
      if (t.includes("=")) {
        extraCommentLines.push(t);
      }
    }
  }
  return { fields, extraCommentLines };
}
