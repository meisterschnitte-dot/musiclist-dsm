import type { AudioTags } from "./audioTags";
import type { ParseGemaOcrResult } from "./parseGemaOcrText";
import { labelcodeWithLcPrefix } from "../blankframeSearch";

/**
 * Tabelle von Audio-Network (Titel, Komponist, Herausgeber, ISWC, ISRC, Labelcode) — meist
 * per Tabulatoren in die Zwischenablage (oft eine dichte Zeile).
 */
export function looksLikeAudioNetworkMetadataText(raw: string): boolean {
  const t = raw.replace(/\u00a0/g, " ");
  if (t.length < 40) return false;
  if (!/\t/.test(t)) return false;
  const first = t
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!first) return false;
  if (!/title/i.test(first) || !/composer/i.test(first)) return false;
  if (!/publisher|isrc|label code/i.test(first)) return false;
  return true;
}

function afterEqHint(s: string): string {
  let v = s
    .trim()
    .replace(/^\s*=\s*Songtitel\s+/i, "");
  const eq = v.indexOf(" =");
  if (eq >= 0) v = v.slice(0, eq).trim();
  v = v.replace(/\s*=\s*(Songtitel|ISRC|Labelcode|ISCR|ISWC|Komponist|Interpret)[^\n]*$/i, "").trim();
  return v;
}

function labelFromPublisherCell(s: string): string {
  let v = afterEqHint(s);
  const p = v.indexOf("(");
  if (p > 0) v = v.slice(0, p).trim();
  return v.replace(/\s+/g, " ").trim();
}

function normIsrcFromCell(s: string): string | null {
  const t = afterEqHint(s);
  if (!t) return null;
  const alnum = t.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  if (alnum.length === 12) return alnum;
  return null;
}

function normLabelcodeFromCell(s: string): string | null {
  const t = s.trim();
  const m1 = t.match(/(\d{3,6})\s*=\s*Labelcode/i);
  if (m1) return labelcodeWithLcPrefix(m1[1]!.trim());
  if (/^\d{3,6}$/.test(t)) return labelcodeWithLcPrefix(t);
  return null;
}

function headerIndices(headers: string[]) {
  const h = headers.map((x) => x.trim().toLowerCase());
  const find = (pred: (s: string) => boolean) => h.findIndex(pred);
  return {
    title: find((s) => s === "title" || s.startsWith("title ")),
    composer: find((s) => s === "composer" || s.startsWith("composer")),
    publisher: find((s) => s === "publisher" || s.startsWith("publisher")),
    iswc: find((s) => s === "iswc" || s.startsWith("iswc")),
    isrc: find((s) => s === "isrc" || s.startsWith("isrc")),
    labelCode: find(
      (s) => s === "label code" || s === "labelcode" || (s.includes("label") && s.includes("code"))
    ),
  };
}

function parseHeaderLine(line: string): string[] {
  return line.split("\t").map((c) => c.replace(/\r/g, "").trim());
}

function isLikelyAnHeaderTableRow(line: string): boolean {
  const t = line.trim().toLowerCase();
  return (
    t.includes("title") &&
    t.includes("composer") &&
    (t.includes("publisher") || t.includes("isrc") || t.includes("label code"))
  );
}

/**
 * Meist die Zeile direkt unter `Title	Composer	…` — mit Tabs, kein erneuter Header.
 */
function findDataRow(lines: string[], headerLine: string): string | null {
  const hi = lines.findIndex((l) => l === headerLine);
  for (let j = (hi >= 0 ? hi : 0) + 1; j < lines.length; j++) {
    const row = lines[j] ?? "";
    if (!row.trim() || !row.includes("\t")) continue;
    if (isLikelyAnHeaderTableRow(row)) continue;
    return row;
  }
  for (const line of lines) {
    if (line === headerLine) continue;
    if (!line.trim() || !line.includes("\t")) continue;
    if (isLikelyAnHeaderTableRow(line)) continue;
    return line;
  }
  return null;
}

export function parseAudioNetworkMetadataText(raw: string): ParseGemaOcrResult {
  const fields: Partial<AudioTags> = {};
  const extraCommentLines: string[] = [];
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.replace(/\u00a0/g, " "))
    .map((l) => l.replace(/\r/g, ""));

  const headerLine = lines.find((l) => /\t/.test(l) && /title/i.test(l) && /composer/i.test(l));
  if (!headerLine) {
    return { fields, extraCommentLines: [] };
  }
  const headers = parseHeaderLine(headerLine);
  const idx = headerIndices(headers);
  const dataLine = findDataRow(lines, headerLine) ?? null;
  if (!dataLine) {
    return { fields, extraCommentLines: [] };
  }
  const cells = dataLine.split("\t");

  const g = (i: number) => (i >= 0 && i < cells.length ? cells[i]!.trim() : "");
  if (idx.title >= 0) {
    const st = afterEqHint(g(idx.title));
    if (st) fields.songTitle = st.replace(/\s+/g, " ");
  }
  if (idx.composer >= 0) {
    const comp = afterEqHint(g(idx.composer));
    if (comp) {
      const one = comp.replace(/\s+/g, " ");
      fields.composer = one;
      fields.artist = one;
    }
  }
  if (idx.publisher >= 0) {
    const lab = labelFromPublisherCell(g(idx.publisher));
    if (lab) fields.label = lab;
  }
  if (idx.isrc >= 0) {
    const is = normIsrcFromCell(g(idx.isrc));
    if (is) fields.isrc = is;
  }
  if (!fields.isrc) {
    const m = dataLine.replace(/\n/g, " ").match(/\b([A-Z]{2}[\s-]?[A-Z0-9]{3}[\s-]?\d{2}[\s-]?\d{2,5})\b/i);
    if (m) {
      const n = m[1]!.replace(/[^A-Z0-9]/gi, "").toUpperCase();
      if (n.length === 12) fields.isrc = n;
    }
  }
  if (idx.labelCode >= 0) {
    const lc = normLabelcodeFromCell(g(idx.labelCode));
    if (lc) fields.labelcode = lc;
  }
  if (!fields.labelcode) {
    const m = dataLine.match(/(\d{3,6})\s*=\s*Labelcode/i);
    if (m) fields.labelcode = labelcodeWithLcPrefix(m[1]!.trim());
  }
  if (!fields.labelcode) {
    const parts = dataLine.split("\t");
    for (let p = parts.length - 1; p >= 0; p--) {
      const t = parts[p]!.trim();
      if (/^\d{3,6}$/.test(t)) {
        fields.labelcode = labelcodeWithLcPrefix(t);
        break;
      }
    }
  }
  if (idx.iswc >= 0) {
    const w = afterEqHint(g(idx.iswc)).replace(/\s+/g, " ").trim();
    if (w && /^T\d+$/i.test(w)) {
      extraCommentLines.push(`ISWC ${w}`);
    }
  }

  return { fields, extraCommentLines };
}
