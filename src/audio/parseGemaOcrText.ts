import type { AudioTags } from "./audioTags";

export type ParseGemaOcrResult = {
  fields: Partial<AudioTags>;
  /** Nicht den festen Feldern zugeordnete Zeilen (für Kommentar anhängen). */
  extraCommentLines: string[];
};

/** Hinter `(LC …)` am Zeilenende steht oft ein doppelter Hinweis — für Label/Verlag ignorieren. */
function stripTrailingParentheticalLabelcode(s: string): string {
  return s
    .replace(/\s*\(\s*LC\s*[\d\s]*\)\s*$/i, "")
    .replace(/\s*\(\s*L\s*C\s*[\d\s]*\)\s*$/i, "")
    .trim();
}

/**
 * GEMA: zuerst Label, dann `/`, dann Verlag (= Hersteller). Alles nach dem ersten `/`
 * ist Verlag; ein angehängtes `(LC …)` am Ende des Verlagsteils wird entfernt.
 */
function splitLabelVerlagGema(raw: string): { label?: string; hersteller?: string } {
  let s = raw.trim();
  if (!s) return {};

  s = stripTrailingParentheticalLabelcode(s);

  const idx = s.indexOf("/");
  if (idx === -1) {
    return s ? { label: s } : {};
  }

  const label = s.slice(0, idx).trim();
  let hersteller = s.slice(idx + 1).trim();
  hersteller = stripTrailingParentheticalLabelcode(hersteller);

  const out: { label?: string; hersteller?: string } = {};
  if (label) out.label = label;
  if (hersteller) out.hersteller = hersteller;
  return out;
}

/** Erkennt typische GEMA-/Lens-OCR-Zeileneinträge (TITEL, CD, JAHR, …). */
function isFieldHeaderLine(line: string): boolean {
  const s = line.trim();
  return (
    /^TITEL\s/i.test(s) ||
    /^CD\s/i.test(s) ||
    /^LIED-NR\b/i.test(s) ||
    /^LANGE\s/i.test(s) ||
    /^JAHR\s/i.test(s) ||
    /^LC-NR\b/i.test(s) ||
    /^CD-KATALOG-NR\b/i.test(s) ||
    /^ISRC-NR\b/i.test(s) ||
    /^INTERPRET\b/i.test(s) ||
    /^LABEL\/VERLAG\b/i.test(s) ||
    /^KOMPONIST\b/i.test(s) ||
    /^GEMA-WERK-NR\b/i.test(s) ||
    /^BEARBEITER\b/i.test(s) ||
    /^INSTRUMENTAL$/i.test(s) ||
    /^ONLINE ONLY$/i.test(s)
  );
}

/**
 * Parst eingefügten Klartext (z. B. Google Lens von GEMA-Recherche).
 * Mehrzeilige Werte nach leerem LABEL/VERLAG oder KOMPONIST werden zusammengezogen.
 */
export function parseGemaOcrText(raw: string): ParseGemaOcrResult {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const fields: Partial<AudioTags> = {};
  const extraCommentLines: string[] = [];
  let i = 0;

  const takeContinuation = (fromIndex: number): { text: string; nextIndex: number } => {
    const parts: string[] = [];
    let j = fromIndex;
    while (j < lines.length && !isFieldHeaderLine(lines[j])) {
      parts.push(lines[j]);
      j++;
    }
    return { text: parts.join(" ").trim(), nextIndex: j };
  };

  while (i < lines.length) {
    const line = lines[i];
    let m: RegExpExecArray | null;

    if ((m = /^TITEL\s+(.+)$/i.exec(line))) {
      fields.songTitle = m[1].trim();
      i++;
      continue;
    }
    if ((m = /^CD\s+(.+)$/i.exec(line))) {
      fields.album = m[1].trim();
      i++;
      continue;
    }
    if ((m = /^LIED-NR\s*(.*)$/i.exec(line))) {
      const v = m[1].trim();
      if (v) extraCommentLines.push(`LIED-NR ${v}`);
      i++;
      continue;
    }
    if ((m = /^LANGE\s+(.+)$/i.exec(line))) {
      extraCommentLines.push(`Länge ${m[1].trim()}`);
      i++;
      continue;
    }
    if ((m = /^JAHR\s*(\d{4})\b/i.exec(line))) {
      fields.year = m[1];
      i++;
      continue;
    }
    if ((m = /^LC-NR\s*(.+)$/i.exec(line))) {
      const v = m[1].trim();
      if (v) fields.labelcode = v;
      i++;
      continue;
    }
    if ((m = /^CD-KATALOG-NR\s*(.*)$/i.exec(line))) {
      const v = m[1].trim();
      if (v) extraCommentLines.push(`CD-Katalog ${v}`);
      i++;
      continue;
    }
    if ((m = /^ISRC-NR\s*(.*)$/i.exec(line))) {
      const v = m[1].trim();
      if (v) extraCommentLines.push(`ISRC ${v}`);
      i++;
      continue;
    }
    if (/^INSTRUMENTAL$/i.test(line)) {
      extraCommentLines.push("Instrumental");
      i++;
      continue;
    }
    if (/^ONLINE ONLY$/i.test(line)) {
      extraCommentLines.push("Online only");
      i++;
      continue;
    }
    if ((m = /^GEMA-WERK-NR\s*(.*)$/i.exec(line))) {
      const v = m[1].trim();
      if (v) extraCommentLines.push(`GEMA-Werk-Nr. ${v}`);
      i++;
      continue;
    }
    if ((m = /^BEARBEITER\s*(.*)$/i.exec(line))) {
      const v = m[1].trim();
      if (v) extraCommentLines.push(`Bearbeiter: ${v}`);
      i++;
      continue;
    }
    if ((m = /^INTERPRET\s*(.*)$/i.exec(line))) {
      let v = m[1].trim();
      i++;
      if (!v) {
        const { text, nextIndex } = takeContinuation(i);
        v = text;
        i = nextIndex;
      }
      if (v) fields.artist = v;
      continue;
    }
    if ((m = /^LABEL\/VERLAG\s*(.*)$/i.exec(line))) {
      let v = m[1].trim();
      i++;
      if (!v) {
        const { text, nextIndex } = takeContinuation(i);
        v = text;
        i = nextIndex;
      }
      if (v) {
        const { label, hersteller } = splitLabelVerlagGema(v);
        if (label) fields.label = label;
        if (hersteller) fields.hersteller = hersteller;
      }
      continue;
    }
    if ((m = /^KOMPONIST\s*(.*)$/i.exec(line))) {
      let v = m[1].trim();
      i++;
      if (!v) {
        const { text, nextIndex } = takeContinuation(i);
        v = text;
        i = nextIndex;
      }
      if (v) fields.composer = v;
      continue;
    }

    extraCommentLines.push(line);
    i++;
  }

  applyArchivmusikInterpretRule(fields);

  return { fields, extraCommentLines };
}

/** GEMA/Lens: Interpret „ARCHIVMUSIK“ → Interpret aus Komponist übernehmen. */
function applyArchivmusikInterpretRule(fields: Partial<AudioTags>): void {
  const artist = fields.artist?.trim();
  const composer = fields.composer?.trim();
  if (!composer) return;
  if (artist && /^ARCHIVMUSIK$/i.test(artist)) {
    fields.artist = composer;
  }
}
