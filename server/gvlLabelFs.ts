import fs from "node:fs/promises";
import path from "node:path";
import { getDataDir } from "./userStore";

const SHARED_DIR = path.join(getDataDir(), "shared");
const GVL_LABEL_DB_FILE = path.join(SHARED_DIR, "gvl-label-db.json");

export type GvlLabelEntry = {
  labelcode: string;
  label: string;
  kuerzel: string;
  plm: string;
  hersteller: string;
  rechterueckrufe: string;
};

export type GvlLabelDb = {
  importedAtIso: string;
  entries: GvlLabelEntry[];
};

let chain: Promise<unknown> = Promise.resolve();

async function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn) as Promise<T>;
  chain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function normalizeEntries(entries: unknown): GvlLabelEntry[] {
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

export function parseGvlLabelDb(raw: unknown): GvlLabelDb | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Partial<GvlLabelDb>;
  if (typeof p.importedAtIso !== "string" || !Array.isArray(p.entries)) return null;
  return { importedAtIso: p.importedAtIso, entries: normalizeEntries(p.entries) };
}

export async function readGvlLabelDb(): Promise<GvlLabelDb | null> {
  return serialize(async () => {
    try {
      const text = await fs.readFile(GVL_LABEL_DB_FILE, "utf8");
      return parseGvlLabelDb(JSON.parse(text) as unknown);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  });
}

export async function writeGvlLabelDb(db: GvlLabelDb): Promise<void> {
  return serialize(async () => {
    await fs.mkdir(SHARED_DIR, { recursive: true });
    await fs.writeFile(GVL_LABEL_DB_FILE, JSON.stringify(db, null, 2), "utf8");
  });
}
