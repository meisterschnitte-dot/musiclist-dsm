import type { AudioTags } from "./audioTags";
import type { ParseGemaOcrResult } from "./parseGemaOcrText";

/**
 * Bibliothèque Music — Kopie aus dem Portal (Track / Code / Album / Composers / Publisher).
 */
export function looksLikeBibliothequeMusicMetadataText(raw: string): boolean {
  const t = raw.replace(/\u00a0/g, " ");
  if (t.length < 40) return false;
  const hasTrack = /^\s*Track\s*$/im.test(t) || /^Track\s*$/m.test(t);
  const hasPub = /^\s*Publisher\s*$/im.test(t) || /Biblioth[eè]que\s+Music/i.test(t);
  const hasComposers = /^\s*Composers?\s*$/im.test(t) || /PRO\s+BMI|PRO\s+ASCAP/i.test(t);
  const hasCode = /^\s*Code\s+/im.test(t);
  return (hasTrack && (hasPub || hasComposers)) || (hasCode && hasPub) || (hasComposers && hasPub);
}

function beforeEqHint(s: string): string {
  let v = s.trim();
  const eq = v.indexOf(" =");
  if (eq >= 0) v = v.slice(0, eq).trim();
  v = v.replace(/\s*=\s*(Songtitel|Albumtitel|ISRC|Label|Komponist|Interpret)[^\n]*$/i, "").trim();
  return v;
}

function pickIsrcFromLine(s: string): string | null {
  const m = s.match(/\bISRC\s+([A-Z0-9]{8,})/i);
  return m?.[1] ? m[1]!.toUpperCase() : null;
}

function nameBeforePro(line: string): string {
  const t = beforeEqHint(line);
  const m = t.match(/^(.+?)\s+PRO\s+/i);
  return m?.[1] ? m[1]!.replace(/\s+/g, " ").trim() : t;
}

function labelFromPublisherLine(line: string): string | null {
  const t = beforeEqHint(line);
  const m = t.match(/^(.+?)\s+PRO\s+/i);
  return m?.[1] ? m[1]!.replace(/\s+/g, " ").trim() : null;
}

export function parseBibliothequeMusicMetadataText(raw: string): ParseGemaOcrResult {
  const fields: Partial<AudioTags> = {};
  const extraCommentLines: string[] = [];
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.replace(/\u00a0/g, " "))
    .map((l) => l.replace(/\r/g, ""));

  let i = 0;
  const skipEmpty = () => {
    while (i < lines.length && !String(lines[i]).trim()) i++;
  };
  const cur = () => (i < lines.length ? String(lines[i]!) : "");
  const next = () => (i < lines.length ? String(lines[i++]!) : "");

  while (i < lines.length) {
    skipEmpty();
    if (i >= lines.length) break;
    const line = cur();
    const lt = line.trim();
    if (!lt) {
      i++;
      continue;
    }

    if (/^Track\s*$/i.test(lt)) {
      i++;
      skipEmpty();
      if (i >= lines.length) break;
      let title = beforeEqHint(next());
      title = title.replace(/\s+Main\s*$/i, "").replace(/\s+/g, " ").trim();
      if (title) fields.songTitle = title;
      continue;
    }

    if (/^Code\s+/i.test(lt)) {
      if (!fields.isrc) {
        const is = pickIsrcFromLine(lt);
        if (is) fields.isrc = is;
      }
      const mCat = /Code\s+([A-Z0-9]{3,})/i.exec(lt);
      if (mCat?.[1] && !/^ISRC$/i.test(mCat[1]!)) {
        extraCommentLines.push(`Code ${mCat[1]!}`);
      }
      i++;
      continue;
    }

    if (/^Album\s*$/i.test(lt)) {
      i++;
      skipEmpty();
      if (i >= lines.length) break;
      const alb = beforeEqHint(next()).replace(/\s+/g, " ").trim();
      if (alb) fields.album = alb;
      continue;
    }

    if (/^Composers?\s*$/i.test(lt)) {
      i++;
      const names: string[] = [];
      while (i < lines.length) {
        const l = String(lines[i]!).trim();
        if (/^Publisher\s*$/i.test(l)) break;
        if (/^Track\s*$/i.test(l) || /^Code\s+/i.test(l) || /^Album\s*$/i.test(l)) break;
        i++;
        if (!l) continue;
        if (/PRO\s+/i.test(l)) {
          const n = nameBeforePro(l);
          if (n) names.push(n);
        }
      }
      if (names.length) {
        const cj = names.join(" / ");
        fields.composer = cj;
        fields.artist = cj;
      }
      continue;
    }

    if (/^Publisher\s*$/i.test(lt)) {
      i++;
      skipEmpty();
      if (i >= lines.length) break;
      const pl = beforeEqHint(next());
      const lab = labelFromPublisherLine(pl);
      if (lab) fields.label = lab;
      continue;
    }

    if (!fields.isrc) {
      const is = pickIsrcFromLine(lt);
      if (is) fields.isrc = is;
    }
    i++;
  }

  if (!fields.isrc) {
    const m = raw.match(/\bISRC\s*([A-Z0-9]{8,})/i);
    if (m?.[1]) fields.isrc = m[1]!.toUpperCase();
  }

  return { fields, extraCommentLines };
}
