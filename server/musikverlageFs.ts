import fs from "node:fs/promises";
import path from "node:path";
import type { MusikverlagId } from "../src/musikverlage/musikverlageCatalog";
import { MUSIKVERLAG_IDS } from "../src/musikverlage/musikverlageCatalog";
import { removeMusikverlagSqliteDb } from "./musikverlageSqlite";
import { getDataDir } from "./userStore";

const ROOT = () => path.join(getDataDir(), "musikverlage");
const CONFIG_FILE = () => path.join(ROOT(), "config.json");
const UPLOADS_DIR = () => path.join(ROOT(), "uploads");

export type MusikverlageEntryStored = {
  apiBaseUrl?: string;
  xlsxFileName?: string | null;
  xlsxUploadedAtIso?: string | null;
};

export type MusikverlageConfigFile = {
  version: 1;
  entries: Partial<Record<MusikverlagId, MusikverlageEntryStored>>;
};

async function ensureDirs(): Promise<void> {
  await fs.mkdir(UPLOADS_DIR(), { recursive: true });
}

function isValidId(id: string): id is MusikverlagId {
  return (MUSIKVERLAG_IDS as string[]).includes(id);
}

export function assertMusikverlagId(id: string): asserts id is MusikverlagId {
  if (!isValidId(id)) {
    throw new Error("Unbekannter Musikverlag.");
  }
}

const UPLOAD_EXTS = [".xlsx", ".xls"] as const;

export function uploadPathForId(id: MusikverlagId, ext: ".xlsx" | ".xls"): string {
  return path.join(UPLOADS_DIR(), `${id}${ext}`);
}

/** Erste vorhandene hochgeladene Tabelle (.xlsx oder .xls), sonst `null`. */
export async function findAnyUploadFile(id: MusikverlagId): Promise<string | null> {
  for (const ext of UPLOAD_EXTS) {
    const p = uploadPathForId(id, ext);
    try {
      const st = await fs.stat(p);
      if (st.isFile()) return p;
    } catch {
      /* nächste Endung */
    }
  }
  return null;
}

export async function readMusikverlageConfig(): Promise<MusikverlageConfigFile> {
  await ensureDirs();
  try {
    const raw = await fs.readFile(CONFIG_FILE(), "utf8");
    const p = JSON.parse(raw) as unknown;
    if (!p || typeof p !== "object") return { version: 1, entries: {} };
    const o = p as Partial<MusikverlageConfigFile>;
    if (o.version !== 1 || !o.entries || typeof o.entries !== "object") {
      return { version: 1, entries: {} };
    }
    const entries: Partial<Record<MusikverlagId, MusikverlageEntryStored>> = {};
    for (const [k, v] of Object.entries(o.entries)) {
      if (!isValidId(k)) continue;
      if (!v || typeof v !== "object") continue;
      const e = v as Partial<MusikverlageEntryStored>;
      entries[k] = {
        apiBaseUrl: typeof e.apiBaseUrl === "string" ? e.apiBaseUrl : undefined,
        xlsxFileName:
          e.xlsxFileName === null || e.xlsxFileName === undefined
            ? e.xlsxFileName ?? undefined
            : String(e.xlsxFileName),
        xlsxUploadedAtIso:
          e.xlsxUploadedAtIso === null || e.xlsxUploadedAtIso === undefined
            ? e.xlsxUploadedAtIso ?? undefined
            : String(e.xlsxUploadedAtIso),
      };
    }
    return { version: 1, entries };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, entries: {} };
    }
    throw e;
  }
}

export async function writeMusikverlageConfig(c: MusikverlageConfigFile): Promise<void> {
  await ensureDirs();
  const sortedKeys = Object.keys(c.entries).sort((a, b) => a.localeCompare(b, "de"));
  const ordered: MusikverlageConfigFile = {
    version: 1,
    entries: {},
  };
  for (const k of sortedKeys) {
    if (!isValidId(k)) continue;
    const v = c.entries[k];
    if (v) ordered.entries[k] = v;
  }
  await fs.writeFile(CONFIG_FILE(), JSON.stringify(ordered, null, 2), "utf8");
}

export async function hasUploadedXlsx(id: MusikverlagId): Promise<boolean> {
  return (await findAnyUploadFile(id)) !== null;
}

export async function removeUploadedXlsx(id: MusikverlagId): Promise<void> {
  removeMusikverlagSqliteDb(id);
  for (const ext of UPLOAD_EXTS) {
    try {
      await fs.unlink(uploadPathForId(id, ext));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
}
