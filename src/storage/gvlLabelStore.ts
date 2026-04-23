import { openSettingsDb, STORE_SETTINGS } from "./idb";

const LS_KEY = "musiclist-gvl-label-db-v1";
const LS_KEY_LEGACY = "easy-gema-gvl-label-db-v1";
const KEY_IDB = "gvlLabelDbV1";

export type GvlLabelEntry = {
  labelcode: string;
  label: string;
  /** Kurzname/Kürzel aus dem PDF (eigene Spalte). */
  kuerzel: string;
  /** PLM aus dem PDF (eigene Spalte). */
  plm: string;
  hersteller: string;
  rechterueckrufe: string;
};

export type GvlLabelDb = {
  importedAtIso: string;
  entries: GvlLabelEntry[];
};

/** Parst Server-Antworten oder importiertes JSON; `null` bei ungültiger Struktur. */
export function parseGvlLabelDbJson(data: unknown): GvlLabelDb | null {
  if (!data || typeof data !== "object") return null;
  const p = data as Partial<GvlLabelDb>;
  if (typeof p.importedAtIso !== "string" || !Array.isArray(p.entries)) return null;
  return { importedAtIso: p.importedAtIso, entries: normalizeGvlEntries(p.entries) };
}

function normalizeGvlEntries(entries: unknown): GvlLabelEntry[] {
  if (!Array.isArray(entries)) return [];
  return (entries as Partial<GvlLabelEntry>[]).map((e) => ({
    labelcode: String(e.labelcode ?? ""),
    label: String(e.label ?? ""),
    kuerzel: typeof e.kuerzel === "string" ? e.kuerzel : "",
    plm: typeof e.plm === "string" ? e.plm : "",
    hersteller: String(e.hersteller ?? ""),
    rechterueckrufe: String(e.rechterueckrufe ?? ""),
  }));
}

export function loadGvlLabelDb(): GvlLabelDb | null {
  try {
    let raw = localStorage.getItem(LS_KEY);
    if (!raw) {
      const old = localStorage.getItem(LS_KEY_LEGACY);
      if (old) {
        localStorage.setItem(LS_KEY, old);
        localStorage.removeItem(LS_KEY_LEGACY);
        raw = old;
      }
    }
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const p = parsed as Partial<GvlLabelDb>;
    if (!Array.isArray(p.entries) || typeof p.importedAtIso !== "string") return null;
    return { importedAtIso: p.importedAtIso, entries: normalizeGvlEntries(p.entries) };
  } catch {
    return null;
  }
}

async function saveGvlLabelDbToIdb(dbValue: GvlLabelDb): Promise<void> {
  try {
    const db = await openSettingsDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_SETTINGS, "readwrite");
      tx.objectStore(STORE_SETTINGS).put(dbValue, KEY_IDB);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}

export async function loadGvlLabelDbFromIdb(): Promise<GvlLabelDb | null> {
  try {
    const db = await openSettingsDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SETTINGS, "readonly");
      const req = tx.objectStore(STORE_SETTINGS).get(KEY_IDB);
      req.onsuccess = () => {
        const r = req.result as unknown;
        if (!r || typeof r !== "object") resolve(null);
        else {
          const o = r as Partial<GvlLabelDb>;
          if (typeof o.importedAtIso !== "string" || !Array.isArray(o.entries)) resolve(null);
          else resolve({ importedAtIso: o.importedAtIso, entries: normalizeGvlEntries(o.entries) });
        }
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export function saveGvlLabelDb(dbValue: GvlLabelDb): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(dbValue));
  } catch {
    /* ignore */
  }
  void saveGvlLabelDbToIdb(dbValue);
}

/** Vergleicht Labelcodes (z. B. „LC 97096“, „97096“) mit Einträgen aus der GVL-Liste. */
export function normalizeLabelcodeForMatch(s: string): string {
  const d = s.replace(/\D/g, "");
  if (d.length > 0) return d.replace(/^0+(?=\d)/, "");
  return s.trim().toLowerCase().replace(/\s+/g, "");
}

export function findGvlEntryByLabelcode(
  db: GvlLabelDb | null,
  labelcodeRaw: string
): GvlLabelEntry | undefined {
  if (!db?.entries?.length || !labelcodeRaw?.trim()) return undefined;
  const n = normalizeLabelcodeForMatch(labelcodeRaw);
  if (!n) return undefined;
  return db.entries.find((e) => normalizeLabelcodeForMatch(e.labelcode) === n);
}

function normalizeGvlLabelForMatch(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Treffer über die Spalte „Label“ (z. B. APL-Publishing-Kopiertext); nicht für jedes Teilwort geeignet.
 */
export function findGvlEntryByLabel(db: GvlLabelDb | null, labelRaw: string): GvlLabelEntry | undefined {
  if (!db?.entries?.length || !labelRaw?.trim()) return undefined;
  const q = normalizeGvlLabelForMatch(labelRaw);
  if (q.length < 3) return undefined;
  let best: GvlLabelEntry | undefined;
  let bestScore = 0;
  for (const e of db.entries) {
    for (const cand of [e.label, e.kuerzel].filter((x) => String(x ?? "").trim().length >= 2)) {
      const el = normalizeGvlLabelForMatch(String(cand));
      if (!el) continue;
      if (el === q) return e;
      let score = 0;
      if (el.includes(q)) score = q.length + 10;
      else if (q.includes(el)) score = el.length + 5;
      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }
  }
  return bestScore >= 8 ? best : undefined;
}
