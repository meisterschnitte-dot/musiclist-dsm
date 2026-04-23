import type { AudioTags } from "./audioTags";
import type { ParseGemaOcrResult } from "./parseGemaOcrText";
import { labelcodeWithLcPrefix } from "../blankframeSearch";

/**
 * Herausgeber-Zeile: alles vor dem ersten `PRO` (PRO ASCAP/BMI/KODA …); bei
 * `… = Label ApS` nur den Namen vor `= Label`, „ApS“ am Ende entfernen.
 */
export function extractAplLabelFromHerausgeberLine(raw: string): string {
  const t = raw.trim();
  if (!t) return "";

  const mEq = /^(.+?)\s*=\s*Label\b/i.exec(t);
  if (mEq) {
    return mEq[1]!.trim().replace(/\s+ApS\s*$/i, "").replace(/\s+A\/S\s*$/i, "").trim();
  }

  const beforePro = t.split(/\bPRO\b/i)[0]!.trim();
  return beforePro.replace(/\s+ApS\s*$/i, "").replace(/\s+A\/S\s*$/i, "").trim();
}

function stripAplCatalogFromAlbum(s: string): string {
  const t = s.trim();
  const stripped = t.replace(/^\s*APL\s+\d+\s+/i, "").trim();
  return stripped || t;
}

/** Führendes Wort „Komponisten“ entfernen (darf nicht in die Felder). */
function stripKomponistenLabel(s: string): string {
  return s
    .replace(/^\s*Komponisten\s*=\s*Interpreten\s*/i, "")
    .replace(/^\s*Komponist(?:en)?\s*=\s*Interpreten\s*/i, "")
    .replace(/^\s*Komponisten\s+/i, "")
    .replace(/^\s*Komponist\s+/i, "")
    .trim();
}

/**
 * APL-Website-Kopiertext (Katalognummer, Code APL … ISRC, Herausgeber mit PRO/IPI).
 */
export function looksLikeAplPublishingMetadata(text: string): boolean {
  const t = text.trim();
  if (t.length < 30) return false;
  if (/Katalognummer\s+APL\s+\d+/i.test(t)) return true;
  if (/Code\s+APL\s+\d+\s+ISRC/i.test(t)) return true;
  if (/Herausgeber/i.test(t) && /=\s*Label\b/i.test(t) && /\bPRO\b/i.test(t) && /\bIPI\b/i.test(t))
    return true;
  if (/\bAPL\s+\d+/.test(t) && /=\s*Songtitel/i.test(t) && (/Herausgeber/i.test(t) || /Katalognummer/i.test(t)))
    return true;
  return false;
}

export function parseAplPublishingMetadataText(raw: string): ParseGemaOcrResult {
  const fields: Partial<AudioTags> = {};
  const extraCommentLines: string[] = [];
  const t = raw.replace(/\r\n/g, "\n");

  // Songtitel: erste Zeile nach der Überschrift „Track“ (ohne das Wort „Track“).
  const mAfterTrack = /(?:^|\n)\s*Track\s*\n+([^\n]+?)(?=\n|\r|$)/i.exec(t);
  if (mAfterTrack && mAfterTrack[1]) {
    let s = mAfterTrack[1].trim();
    if (s && !/^Code\s+APL/i.test(s) && !/^Album\b/i.test(s) && !/^Katalognummer/i.test(s)) {
      s = s.replace(/\s*=\s*Songtitel\s*$/i, "").trim();
      if (s) fields.songTitle = s;
    }
  }
  if (!fields.songTitle) {
    const mTitle = /([^\n=]+?)\s*=\s*Songtitel\s*$/gim;
    const mt = mTitle.exec(t);
    if (mt && mt[1]) {
      let s = mt[1].trim();
      s = s.replace(/^(?:Wir\s+)?[^\n]*?Track\s*\n/i, "").replace(/^Track\s*\n/i, "").trim();
      if (s) fields.songTitle = s;
    }
  }

  const mCode = /Code\s+APL\s+(\d{3,6})\s+ISRC\s+([A-Z0-9]{12})/i.exec(t);
  if (mCode) {
    fields.labelcode = labelcodeWithLcPrefix(mCode[1]!);
    fields.isrc = mCode[2]!.toUpperCase();
  } else {
    const mIs = /\bISRC\s+([A-Z0-9]{12})\b/i.exec(t);
    if (mIs) fields.isrc = mIs[1]!.toUpperCase();
    const mK2 = /Katalognummer\s+APL\s+(\d{3,6})/i.exec(t);
    if (mK2) fields.labelcode = labelcodeWithLcPrefix(mK2[1]!);
  }

  // Albumtitel: Zeile(n) direkt nach der Überschrift „Album“.
  const mAfterAlbum = /(?:^|\n)\s*Album\s*\n+([^\n]+?)(?=\n|\r|$)/i.exec(t);
  if (mAfterAlbum && mAfterAlbum[1]) {
    let line = mAfterAlbum[1].trim().replace(/\s*=\s*Albumtitel\s*$/i, "").trim();
    if (line && !/^Komponisten?\b/i.test(line) && !/^Herausgeber/i.test(line)) {
      fields.album = stripAplCatalogFromAlbum(line);
    }
  }
  if (!fields.album) {
    const mAlbum = /([^\n=]+?)\s*=\s*Albumtitel\s*$/gim;
    const ma = mAlbum.exec(t);
    if (ma && ma[1]) {
      fields.album = stripAplCatalogFromAlbum(ma[1].trim());
    }
  }

  // Namen: Zeile nach „Komponisten“ (Überschrift), oder derselben Zeile „Komponisten Name … PRO“.
  const mAfterKomp = /(?:^|\n)\s*Komponisten?\s*\n+([^\n]+)/i.exec(t);
  if (mAfterKomp && mAfterKomp[1]) {
    let n = mAfterKomp[1]!.split(/\bPRO\b/i)[0]!;
    n = n.replace(/\s+Share\s+100\s*$/i, "").replace(/\s+Share\s+\d{1,3}%\s*$/i, "").trim();
    n = stripKomponistenLabel(n);
    if (n) {
      fields.composer = n;
      fields.artist = n;
    }
  }
  if (!fields.composer) {
    const mKompInline = /(?:^|\n)\s*Komponisten\s+(.+?)(?=\s+\bPRO\b)/i.exec(t);
    if (mKompInline && mKompInline[1]) {
      let n = mKompInline[1].replace(/\s+Share\s+100\s*$/i, "").replace(/\s+Share\s+\d{1,3}%\s*$/i, "").trim();
      n = stripKomponistenLabel(n);
      if (n) {
        fields.composer = n;
        fields.artist = n;
      }
    }
  }
  const mComp = /([^\n=]+?)\s*=\s*Komponist(?:en)?\s*=\s*Interpreten/i.exec(t);
  if (mComp && mComp[1] && !fields.composer) {
    let n = mComp[1]!.split(/\bPRO\b/i)[0]!.replace(/\s+Share\s+100\s*$/i, "").replace(/\s+Share\s+\d{1,3}%\s*$/i, "").trim();
    n = stripKomponistenLabel(n);
    if (n) {
      fields.composer = n;
      fields.artist = n;
    }
  }
  if (!fields.composer) {
    const mC2 = /([A-Z][A-Za-zÀ-ÿ'`.-]+(?:\s+[A-Z][A-Za-zÀ-ÿ'`.-]+)+)\s+PRO\s+ASCAP/i.exec(t);
    if (mC2 && mC2[1]) {
      const n4 = stripKomponistenLabel(mC2[1].trim());
      if (n4) {
        fields.composer = n4;
        fields.artist = n4;
      }
    }
  }
  if (fields.composer) {
    fields.composer = stripKomponistenLabel(fields.composer);
  }
  if (fields.artist) {
    fields.artist = stripKomponistenLabel(fields.artist);
  }

  const mH = /Herausgeber[:\s]*\n([^\n]+)/i.exec(t);
  if (mH && mH[1]) {
    const lab = extractAplLabelFromHerausgeberLine(mH[1].trim());
    if (lab) fields.label = lab;
  } else {
    const mH2 = /Herausgeber[:\s]+([^\n]+)/i.exec(t);
    if (mH2 && mH2[1] && /PRO|IPI|Label/i.test(mH2[1])) {
      const lab = extractAplLabelFromHerausgeberLine(mH2[1].trim());
      if (lab) fields.label = lab;
    }
  }

  for (const k of ["songTitle", "album", "composer", "artist", "label", "isrc", "labelcode"] as const) {
    if (typeof fields[k] === "string") {
      (fields as Record<string, string>)[k] = fields[k]!.replace(/\s+/g, " ").trim();
    }
  }

  return { fields, extraCommentLines };
}
