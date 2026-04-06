import { GlobalWorkerOptions, getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { GvlLabelEntry } from "../storage/gvlLabelStore";

type TextItem = {
  str: string;
  transform: number[];
};

type ColSeg = "code" | "label" | "kuerzel" | "plm" | "hersteller" | "rechter";

type Row = {
  code: string;
  label: string;
  kuerzel: string;
  plm: string;
  hersteller: string;
  rechter: string;
};

/** Sortierte X-Positionen der Spaltenköpfe (PDF kann Kürzel/PLM enthalten). */
type GvlPdfColumns = { anchors: { key: ColSeg; x: number }[] };

const RX_CODE = /^\d{5,6}$/;
const RX_RECHTER = /^R\d+(?:;R\d+)*$/i;

function normalizeSpaces(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function joinCell(parts: string[]): string {
  return normalizeSpaces(parts.join(" "));
}

function normalizeLabelcodeCandidate(raw: string): string | null {
  const digitsOnly = raw.replace(/\D/g, "");
  if (!RX_CODE.test(digitsOnly)) return null;
  return digitsOnly;
}

/** Länge der ersten durchgehenden Zifferngruppe (nach führendem Whitespace). */
function leadingDigitRunLength(s: string): number {
  const t = s.trimStart();
  let n = 0;
  while (n < t.length && t[n] >= "0" && t[n] <= "9") n++;
  return n;
}

/** Sechsstellige Folge wie 201510 (YYYYMM) — typisch Datum im Label, nicht Labelcode-Zeile. */
function looksLikeYearMonth6(s: string): boolean {
  if (!/^\d{6}$/.test(s)) return false;
  const y = Number.parseInt(s.slice(0, 4), 10);
  const m = Number.parseInt(s.slice(4, 6), 10);
  return y >= 1990 && y <= 2039 && m >= 1 && m <= 12;
}

/**
 * PDF zerlegt breite 6-stellige Codes oft über Spaltengrenzen (z. B. "100" + "000 …").
 * Wir lesen am Zeilenanfang nur Ziffern (Leerzeichen dazwischen erlaubt), bis 5–6 Ziffern da sind.
 * Nach genau 5 Ziffern und Leerzeichen wird eine einzelne weitere Ziffer nicht angehängt, wenn
 * danach sofort ein Buchstabe folgt (Label wie „1DB Records“), damit nicht z. B. 996571 entsteht.
 */
function extractLeadingLabelcodeFromLineStart(text: string): { code: string | null; rest: string } {
  const t = normalizeSpaces(text);
  let j = 0;
  while (j < t.length && /\s/.test(t[j])) j++;
  let digits = "";
  while (j < t.length) {
    const ch = t[j];
    if (ch >= "0" && ch <= "9") {
      digits += ch;
      j++;
      if (digits.length > 6) {
        return { code: null, rest: t };
      }
      if (digits.length >= 6) {
        break;
      }
      continue;
    }
    if (ch === " " || ch === "\u00a0") {
      if (digits.length === 5) {
        let k = j;
        while (k < t.length && /\s/.test(t[k])) k++;
        if (k < t.length && t[k] >= "0" && t[k] <= "9") {
          const runStart = k;
          while (k < t.length && t[k] >= "0" && t[k] <= "9") k++;
          const run = t.slice(runStart, k);
          const afterRun = k < t.length ? t[k] : "";
          if (run.length === 1 && /[A-Za-zÄÖÜäöüß]/.test(afterRun)) {
            break;
          }
          if (digits.length + run.length === 6) {
            digits += run;
            j = k;
            break;
          }
          if (digits.length + run.length < 6) {
            digits += run;
            j = k;
            if (digits.length >= 6) break;
            continue;
          }
          return { code: null, rest: t };
        }
      }
      j++;
      continue;
    }
    break;
  }
  if (RX_CODE.test(digits)) {
    return { code: digits, rest: normalizeSpaces(t.slice(j)) };
  }
  return { code: null, rest: t };
}

function isKuerzelHeader(t: string): boolean {
  const u = normalizeSpaces(t);
  return u === "Kürzel" || /^kurzname$/i.test(u);
}

function isPlmHeader(t: string): boolean {
  const u = normalizeSpaces(t);
  if (u === "PLM") return true;
  return /^PLM[-\s]/i.test(u) && u.length <= 28;
}

function segmentForX(x: number, anchors: { key: ColSeg; x: number }[]): ColSeg {
  if (anchors.length === 0) return "label";
  const last = anchors.length - 1;
  for (let i = 0; i < last; i++) {
    const mid = (anchors[i].x + anchors[i + 1].x) / 2;
    if (x < mid) return anchors[i].key;
  }
  return anchors[last].key;
}

function extractColumnsByX(items: TextItem[]): GvlPdfColumns | null {
  let xCode = Number.NaN;
  let xLabel = Number.NaN;
  let xHersteller = Number.NaN;
  let xRechter = Number.NaN;
  let xKuerzel: number | undefined;
  let xPlm: number | undefined;
  for (const it of items) {
    const t = normalizeSpaces(it.str);
    if (!t) continue;
    const x = it.transform?.[4] ?? 0;
    if (t === "Labelcode") xCode = x;
    else if (t === "Label") xLabel = x;
    else if (isKuerzelHeader(t)) xKuerzel = x;
    else if (isPlmHeader(t)) xPlm = x;
    else if (t === "Hersteller") xHersteller = x;
    else if (t === "Rechterückrufe") xRechter = x;
  }
  if ([xCode, xLabel, xHersteller, xRechter].some((n) => Number.isNaN(n))) return null;
  const anchors: { key: ColSeg; x: number }[] = [
    { key: "code", x: xCode },
    { key: "label", x: xLabel },
  ];
  if (xKuerzel !== undefined) anchors.push({ key: "kuerzel", x: xKuerzel });
  if (xPlm !== undefined) anchors.push({ key: "plm", x: xPlm });
  anchors.push({ key: "hersteller", x: xHersteller }, { key: "rechter", x: xRechter });
  anchors.sort((a, b) => a.x - b.x);
  return { anchors };
}

function lineKeyFromY(y: number): string {
  return (Math.round(y * 2) / 2).toFixed(1);
}

type LineBuckets = {
  y: number;
  code: string[];
  label: string[];
  kuerzel: string[];
  plm: string[];
  hersteller: string[];
  rechter: string[];
};

function emptyLineBuckets(y: number): LineBuckets {
  return { y, code: [], label: [], kuerzel: [], plm: [], hersteller: [], rechter: [] };
}

function pushToBucket(b: LineBuckets, seg: ColSeg, str: string): void {
  switch (seg) {
    case "code":
      b.code.push(str);
      break;
    case "label":
      b.label.push(str);
      break;
    case "kuerzel":
      b.kuerzel.push(str);
      break;
    case "plm":
      b.plm.push(str);
      break;
    case "hersteller":
      b.hersteller.push(str);
      break;
    case "rechter":
      b.rechter.push(str);
      break;
  }
}

/**
 * PDF-Seiten sind getrennt — bricht z. B. „Universal Music Entertainment GmbH“
 * im Hersteller um, steht der Rest auf der nächsten Seite ohne neue Labelcode-Zeile.
 * Dann würde die Fortsetzung verworfen (`if (!cur) continue`).
 *
 * @param seedRow Letzte Zeile der vorherigen Seite (noch nicht in `rows` ausgegeben).
 * @param flushAtEnd true auf der letzten PDF-Seite: offene Zeile abschließen und ausgeben.
 */
function toRowsByColumns(
  items: TextItem[],
  cols: GvlPdfColumns,
  seedRow: Row | null,
  flushAtEnd: boolean
): { rows: Row[]; carry: Row | null } {
  const anchors = cols.anchors;
  const lines = new Map<string, LineBuckets>();
  for (const it of items) {
    const str = normalizeSpaces(it.str);
    if (!str) continue;
    const x = it.transform?.[4] ?? 0;
    const y = it.transform?.[5] ?? 0;
    const key = lineKeyFromY(y);
    if (!lines.has(key)) {
      lines.set(key, emptyLineBuckets(y));
    }
    const row = lines.get(key)!;
    const seg = segmentForX(x, anchors);
    pushToBucket(row, seg, str);
  }

  const ordered = [...lines.values()].sort((a, b) => b.y - a.y);
  const rows: Row[] = [];
  let cur: Row | null = seedRow ?? null;
  for (const l of ordered) {
    const codeCol = joinCell(l.code);
    const labelCol = joinCell(l.label);
    const kuerzelCol = joinCell(l.kuerzel);
    const plmCol = joinCell(l.plm);
    const hersteller = joinCell(l.hersteller);
    const rechter = joinCell(l.rechter);

    if (
      /https:\/\/labelrecherche\.gvl\.de\//i.test(
        `${codeCol} ${labelCol} ${kuerzelCol} ${plmCol} ${hersteller} ${rechter}`
      ) ||
      /^--\s*\d+\s+of\s+\d+\s*--$/i.test(
        `${codeCol} ${labelCol} ${kuerzelCol} ${plmCol} ${hersteller} ${rechter}`
      )
    ) {
      continue;
    }
    if (/^Labelcode$/i.test(codeCol) && /^Label$/i.test(labelCol)) continue;

    const fromCodeCol = normalizeLabelcodeCandidate(codeCol);
    let code: string | null;
    let label: string;
    if (fromCodeCol) {
      code = fromCodeCol;
      label = labelCol;
    } else {
      if (cur) {
        const lt = labelCol.trim();
        if (/^\d{6}$/.test(lt) && looksLikeYearMonth6(lt)) {
          cur.label = normalizeSpaces(`${cur.label} ${lt}`);
          if (kuerzelCol) cur.kuerzel = normalizeSpaces(`${cur.kuerzel} ${kuerzelCol}`);
          if (plmCol) cur.plm = normalizeSpaces(`${cur.plm} ${plmCol}`);
          if (hersteller) cur.hersteller = normalizeSpaces(`${cur.hersteller} ${hersteller}`);
          if (RX_RECHTER.test(rechter)) {
            cur.rechter = cur.rechter ? `${cur.rechter};${rechter}` : rechter;
          }
          continue;
        }
        const codeRun = leadingDigitRunLength(codeCol);
        const labelRun = leadingDigitRunLength(labelCol);
        if (codeRun > 6 || labelRun > 6) {
          const piece =
            codeRun > 6 && labelCol.trim() && /[A-Za-zÄÖÜäöüß]/.test(labelCol)
              ? normalizeSpaces(`${labelCol} ${codeCol}`)
              : normalizeSpaces(`${codeCol} ${labelCol}`);
          if (piece) cur.label = normalizeSpaces(`${cur.label} ${piece}`);
          if (kuerzelCol) cur.kuerzel = normalizeSpaces(`${cur.kuerzel} ${kuerzelCol}`);
          if (plmCol) cur.plm = normalizeSpaces(`${cur.plm} ${plmCol}`);
          if (hersteller) cur.hersteller = normalizeSpaces(`${cur.hersteller} ${hersteller}`);
          if (RX_RECHTER.test(rechter)) {
            cur.rechter = cur.rechter ? `${cur.rechter};${rechter}` : rechter;
          }
          continue;
        }
      }
      const lineStartForCode = normalizeSpaces(`${codeCol} ${labelCol}`);
      const peeled = extractLeadingLabelcodeFromLineStart(lineStartForCode);
      code = peeled.code;
      label = peeled.code ? peeled.rest || labelCol : labelCol;
    }

    if (code) {
      if (cur) rows.push(cur);
      cur = {
        code,
        label,
        kuerzel: kuerzelCol,
        plm: plmCol,
        hersteller,
        rechter: RX_RECHTER.test(rechter) ? rechter : "",
      };
      continue;
    }
    if (!cur) continue;
    if (label) cur.label = normalizeSpaces(`${cur.label} ${label}`);
    if (kuerzelCol) cur.kuerzel = normalizeSpaces(`${cur.kuerzel} ${kuerzelCol}`);
    if (plmCol) cur.plm = normalizeSpaces(`${cur.plm} ${plmCol}`);
    if (hersteller) cur.hersteller = normalizeSpaces(`${cur.hersteller} ${hersteller}`);
    if (RX_RECHTER.test(rechter)) {
      cur.rechter = cur.rechter ? `${cur.rechter};${rechter}` : rechter;
    }
  }
  if (flushAtEnd && cur) rows.push(cur);
  return { rows, carry: flushAtEnd ? null : cur };
}

function uniqKeepOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function mergeGvlPdfRowIntoMap(byCode: Map<string, GvlLabelEntry>, r: Row): void {
  const code = normalizeLabelcodeCandidate(r.code);
  if (!code) return;
  const prev = byCode.get(code);
  const mergedRechter = uniqKeepOrder(
    [prev?.rechterueckrufe ?? "", r.rechter]
      .join(";")
      .split(";")
      .map((x) => x.trim())
      .filter((x) => RX_RECHTER.test(x))
  ).join(";");
  byCode.set(code, {
    labelcode: code,
    label: normalizeSpaces(r.label || prev?.label || ""),
    kuerzel: normalizeSpaces(r.kuerzel || prev?.kuerzel || ""),
    plm: normalizeSpaces(r.plm || prev?.plm || ""),
    hersteller: normalizeSpaces(r.hersteller || prev?.hersteller || ""),
    rechterueckrufe: mergedRechter,
  });
}

export async function parseGvlLabelPdfFile(
  file: File,
  onProgress?: (donePages: number, totalPages: number) => void
): Promise<GvlLabelEntry[]> {
  GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.mjs",
    import.meta.url
  ).toString();

  const buf = await file.arrayBuffer();
  const task = getDocument({ data: new Uint8Array(buf) });
  const doc = await task.promise;
  const byCode = new Map<string, GvlLabelEntry>();
  let fallbackCols: GvlPdfColumns | null = null;
  /** Letzte Tabellenzeile der vorherigen Seite (bei Seitenumbruch vor nächster Seite ausgeben). */
  let carryRow: Row | null = null;

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = (content.items as unknown[]).filter(
      (x): x is TextItem =>
        !!x && typeof x === "object" && "str" in x && "transform" in x && Array.isArray((x as any).transform)
    );
    const cols: GvlPdfColumns | null = extractColumnsByX(items) ?? fallbackCols;
    if (!cols) continue;
    fallbackCols = cols;
    const flushAtEnd = p === doc.numPages;
    const { rows, carry } = toRowsByColumns(items, cols, carryRow, flushAtEnd);
    carryRow = carry;
    for (const r of rows) {
      mergeGvlPdfRowIntoMap(byCode, r);
    }
    onProgress?.(p, doc.numPages);
  }

  if (carryRow) {
    mergeGvlPdfRowIntoMap(byCode, carryRow);
  }

  return [...byCode.values()].sort((a, b) => {
    const na = Number.parseInt(a.labelcode, 10);
    const nb = Number.parseInt(b.labelcode, 10);
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
    return a.labelcode.localeCompare(b.labelcode, "de", { numeric: true });
  });
}
