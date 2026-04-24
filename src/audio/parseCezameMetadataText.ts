import type { AudioTags } from "./audioTags";
import type { ParseGemaOcrResult } from "./parseGemaOcrText";
import { labelcodeWithLcPrefix } from "../blankframeSearch";

/**
 * Cézame (de.cezamemusic.com) / ähnliche Exporte: „Schlüssel : Wert“ mit FR/DE/EN,
 * ggf. mit „ = Hinweis“ am Wert (z. B. „= Songtitel“) — wird abgeschnitten.
 */
export function looksLikeCezameMetadataText(raw: string): boolean {
  const t = raw.replace(/\u00a0/g, " ");
  if (t.trim().length < 20) return false;
  let s = 0;
  if (/\bTitre\s*:/i.test(t)) s++;
  if (/\bTitel\s*:/i.test(t)) s++;
  if (/\bReferenz\s*:/i.test(t)) s++;
  if (/\bR[eé]f[ée]rence\s*:/i.test(t)) s++;
  if (/Composer\s*\(s\)\s*:/i.test(t)) s++;
  if (/Songwriter\s*\(s\)\s*:/i.test(t)) s++;
  if (/\bLC\s*:/i.test(t)) s++;
  if (/\bAlbum\s*:/i.test(t)) s++;
  if (/\bISRC\s*:/i.test(t)) s++;
  if (/Ver[öo]ffentlichungsdatum\s*:/i.test(t)) s++;
  if (/Publisher\s*\(s\)\s*:/i.test(t)) s++;
  return s >= 2;
}

function stripValueHint(value: string): string {
  let v = value.trim();
  const eq = v.indexOf(" = ");
  if (eq !== -1) v = v.slice(0, eq).trim();
  const eq2 = v.search(/\s*=\s*(Songtitel|Albumtitel|Labelcode|Komponist|ISRC|ISCR|Interpret|zusätzliche)/i);
  if (eq2 > 0) v = v.slice(0, eq2).trim();
  return v;
}

function normalizeKeyForMap(keyRaw: string): string {
  return keyRaw
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function yearFromReleaseDate(s: string): string | undefined {
  const t = s.trim();
  const m1 = t.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (m1) return m1[3];
  if (/^\d{4}$/.test(t)) return t;
  return undefined;
}

/**
 * Eine Zeile „Schlüssel : alles ab erstem Doppelpunkt“.
 * Der Erste Doppelpunkt trennt nur den Schlüssel, Rest ist Wert.
 */
function parseKeyValueLine(line: string): { key: string; value: string } | null {
  const idx = line.indexOf(":");
  if (idx <= 0) return null;
  const key = line.slice(0, idx).trim();
  const value = line.slice(idx + 1);
  if (!key) return null;
  return { key, value: stripValueHint(value) };
}

export function parseCezameMetadataText(raw: string): ParseGemaOcrResult {
  const fields: Partial<AudioTags> = {};
  const extraCommentLines: string[] = [];
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.replace(/\u00a0/g, " ").trim())
    .filter((l) => l.length > 0);

  let composerVal = "";
  let songwriterVal = "";
  for (const line of lines) {
    const parsed = parseKeyValueLine(line);
    if (!parsed) {
      extraCommentLines.push(line);
      continue;
    }
    const nk = normalizeKeyForMap(parsed.key);
    const keyNoSpace = nk.replace(/\s+/g, "");
    const val = parsed.value.replace(/\s+/g, " ").trim();
    if (!val) continue;

    if (nk === "titre" || nk === "titel") {
      fields.songTitle = val;
      continue;
    }
    if (nk === "referenz" || nk === "reference") {
      extraCommentLines.push(`Referenz: ${val}`);
      continue;
    }
    if (keyNoSpace === "composer(s)" || nk === "composer") {
      composerVal = val;
      fields.composer = val;
      fields.artist = val;
      continue;
    }
    if (keyNoSpace === "songwriter(s)" || nk === "songwriter") {
      songwriterVal = val;
      continue;
    }
    if (keyNoSpace === "publisher(s)" || nk === "publisher") {
      extraCommentLines.push(`Publisher(s): ${val}`);
      continue;
    }
    if (nk === "lc" || nk === "labelcode" || nk === "label code") {
      const digits = val.replace(/\D/g, "");
      if (digits) {
        fields.labelcode = labelcodeWithLcPrefix(digits);
      } else {
        fields.labelcode = val;
      }
      continue;
    }
    if (nk === "album") {
      fields.album = val;
      continue;
    }
    if (nk === "isrc" || nk === "isrc-nr") {
      fields.isrc = val.replace(/\s+/g, " ").trim();
      continue;
    }
    if (nk.includes("ffentlichungsdatum")) {
      const y = yearFromReleaseDate(val);
      if (y) {
        fields.year = y;
      } else {
        extraCommentLines.push(`Veröffentlichungsdatum: ${val}`);
      }
      continue;
    }

    extraCommentLines.push(line);
  }

  if (songwriterVal && songwriterVal !== composerVal) {
    const c = (fields.composer ?? "").trim();
    fields.composer = c ? `${c} · ${songwriterVal}` : songwriterVal;
  }

  return { fields, extraCommentLines };
}
