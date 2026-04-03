import type { AudioTags } from "./audioTags";
import type { ParseGemaOcrResult } from "./parseGemaOcrText";

/** Rollen am Zeilenende (Apple Music DE, gendergerechte Schreibweise). */
const ROLE_CHUNK =
  /(?:Songwriter:in|Komponist:in|Streicher-Arrangeur:in|Arrangeur:in|Lyricist:in|Textdichter:in)/gi;

function isRoleOnlyLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  const withoutRoles = t.replace(ROLE_CHUNK, "").replace(/\s*,\s*/g, " ").replace(/\s+/g, " ").trim();
  return withoutRoles.length === 0;
}

function stripTrailingRoles(line: string): string {
  let s = line.trim();
  let prev = "";
  const endRoles =
    /(?:\s+|^)(?:Songwriter:in|Komponist:in|Streicher-Arrangeur:in|Arrangeur:in|Lyricist:in|Textdichter:in)(?:\s*,\s*(?:Songwriter:in|Komponist:in|Streicher-Arrangeur:in|Arrangeur:in|Lyricist:in|Textdichter:in))*$/i;
  while (s !== prev) {
    prev = s;
    s = s.replace(endRoles, "").trim();
  }
  return s.trim();
}

function looksLikePersonName(s: string): boolean {
  const t = s.trim();
  if (t.length < 2) return false;
  if (/^\d+$/.test(t)) return false;
  if (/^(Songwriter|Komponist|Streicher|Hörprobe|Apple|Komposition)/i.test(t)) return false;
  return /[^\d\s,.;:/\\]/.test(t);
}

/** Zwei Großbuchstaben (US, DF, …) — Länder-/Markenkürzel in Apple-Listen. */
function isLikelyCountryOrMarketCode(line: string): boolean {
  return /^[A-Z]{2}$/.test(line.trim());
}

/**
 * Erkennt von Apple Music kopierte Seitentexte (Abschnitt „Komposition und Liedtext“).
 */
export function looksLikeAppleMusicCreditsText(text: string): boolean {
  const t = text.trim();
  if (t.length < 40) return false;
  if (/Komposition\s+und\s+Liedtext/i.test(t)) return true;
  return /Songwriter:in/i.test(t) && /(Komponist:in|Hörprobe)/i.test(t);
}

/** Optionale Kopfzeilen vor dem Credits-Block (=Songtitel / Album / Interpret / Jahr). */
function parseAppleHeaderOptional(raw: string, fields: Partial<AudioTags>): void {
  const lines = raw.split(/\r?\n/).map((l) => l.trim());
  for (const line of lines) {
    if (/Komposition\s+und\s+Liedtext/i.test(line)) break;
    if (!line || /^Hörprobe$/i.test(line)) continue;

    const mSong = line.match(/^(.+?)\s*=\s*Songtitel\s*$/i);
    if (mSong) {
      fields.songTitle = mSong[1].trim();
      continue;
    }
    const mAlbum = line.match(/^(.+?)\s*=\s*Albumtitel\s*$/i);
    if (mAlbum) {
      fields.album = mAlbum[1].trim();
      continue;
    }
    const mArt = line.match(/^(.+?)\s*=\s*Interpret\b/i);
    if (mArt) {
      let a = mArt[1].trim();
      a = a.replace(/\s+\d{1,2}\.\s*\w+\s*(19|20)\d{2}\s*$/i, "").trim();
      fields.artist = a;
      continue;
    }
    const y = line.match(/\b(19|20)\d{2}\b/);
    if (y && !fields.year) fields.year = y[0];
  }
}

/**
 * Liest aus dem Block „Komposition und Liedtext“ nur Personennamen und verbindet sie mit Komma.
 * Überschriftenzeilen und reine Rollen-/Länderzeilen werden übersprungen.
 */
export function parseAppleMusicCreditsText(raw: string): ParseGemaOcrResult {
  const fields: Partial<AudioTags> = {};
  const extraCommentLines: string[] = [];

  parseAppleHeaderOptional(raw, fields);

  const mBlock = raw.match(/Komposition\s+und\s+Liedtext\s*(?:\n|\r\n)?([\s\S]*)/i);
  if (!mBlock) {
    return { fields, extraCommentLines };
  }

  const lines = mBlock[1].split(/\r?\n/).map((l) => l.trim());

  const names: string[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    if (!line) continue;
    if (/[©℗]/.test(line)) continue;
    if (isLikelyCountryOrMarketCode(line)) continue;
    if (isRoleOnlyLine(line)) continue;
    const name = stripTrailingRoles(line);
    if (!name || isRoleOnlyLine(name)) continue;
    if (!looksLikePersonName(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }

  if (names.length) {
    fields.composer = names.join(", ");
  }

  return { fields, extraCommentLines };
}
