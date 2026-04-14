import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import Database from "better-sqlite3";
import type { MusikverlagId } from "../src/musikverlage/musikverlageCatalog";
import {
  parseWcpmHeaderRow,
  wcpmFilenameStem,
  wcpmRowToTagPayload,
  type WcpmTagPayload,
} from "../src/musikverlage/wcpmTable";
import { getDataDir } from "./userStore";

const requireXlsx = createRequire(import.meta.url);
const XLSX = requireXlsx("xlsx") as typeof import("xlsx");

const DB_DIR = () => path.join(getDataDir(), "musikverlage", "db");

/** Eine SQLite-Datei pro Musikverlag mit hochgeladener Excel-Tabelle. */
export function sqlitePathForMusikverlag(id: MusikverlagId): string {
  return path.join(DB_DIR(), `${id}.sqlite`);
}

export function removeMusikverlagSqliteDb(id: MusikverlagId): void {
  const p = sqlitePathForMusikverlag(id);
  try {
    fs.unlinkSync(p);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}

export function musikverlagSqliteExists(id: MusikverlagId): boolean {
  try {
    return fs.statSync(sqlitePathForMusikverlag(id)).isFile();
  } catch {
    return false;
  }
}

export function countRowsInMusikverlagDb(id: MusikverlagId): number | null {
  if (!musikverlagSqliteExists(id)) return null;
  const db = new Database(sqlitePathForMusikverlag(id), { readonly: true });
  try {
    const fmt = db.prepare("SELECT v FROM meta WHERE k = ?").get("format") as { v: string } | undefined;
    if (fmt?.v === "wcpm_v1") {
      const r = db.prepare("SELECT COUNT(*) AS c FROM wcpm_tracks").get() as { c: number };
      return r.c;
    }
    if (fmt?.v === "generic_excel_v1") {
      const r = db.prepare("SELECT COUNT(*) AS c FROM sheet_rows").get() as { c: number };
      return r.c;
    }
    return null;
  } finally {
    db.close();
  }
}

export type RebuildMusikverlagDbResult = { rowCount: number };

/**
 * Liest die Excel-Datei ein und legt/ersetzt die SQLite-Zuordnung für diesen Verlag.
 * WCPM: indizierte Suchtabelle; sonst: Rohzeilen der ersten Tabelle für spätere Auswertung.
 */
export function rebuildMusikverlagTableDb(id: MusikverlagId, excelPath: string): RebuildMusikverlagDbResult {
  fs.mkdirSync(DB_DIR(), { recursive: true });
  removeMusikverlagSqliteDb(id);
  try {
    if (id === "wcpm") {
      return rebuildWcpmDb(excelPath, id);
    }
    return rebuildGenericExcelDb(excelPath, id);
  } catch (e) {
    removeMusikverlagSqliteDb(id);
    throw e;
  }
}

function readFirstSheetRows(excelPath: string): { sheetName: string; rows: unknown[][] } {
  const wb = XLSX.readFile(excelPath);
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("Excel-Datei enthält keine Tabelle.");
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error("Excel-Datei enthält keine Tabelle.");
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: "",
    raw: false,
  }) as unknown[][];
  return { sheetName, rows };
}

function rebuildWcpmDb(excelPath: string, id: MusikverlagId): RebuildMusikverlagDbResult {
  const { rows } = readFirstSheetRows(excelPath);
  if (!rows.length) throw new Error("Tabelle ist leer.");
  const headerMap = parseWcpmHeaderRow(rows[0]!);
  if (!headerMap) throw new Error("Unerwartete Kopfzeile in der WCPM-Tabelle.");

  const dbPath = sqlitePathForMusikverlag(id);
  const db = new Database(dbPath);
  try {
    db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE meta (
        k TEXT PRIMARY KEY NOT NULL,
        v TEXT NOT NULL
      );
      INSERT INTO meta (k, v) VALUES ('format', 'wcpm_v1');
      CREATE TABLE wcpm_tracks (
        filename_stem TEXT NOT NULL PRIMARY KEY,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX idx_wcpm_filename_stem ON wcpm_tracks(filename_stem);
    `);
    const ins = db.prepare(
      `INSERT OR REPLACE INTO wcpm_tracks (filename_stem, payload_json) VALUES (?, ?)`
    );
    const insertAll = db.transaction((): number => {
      let n = 0;
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        if (!Array.isArray(row) || row.length === 0) continue;
        const stem = wcpmFilenameStem(String(row[headerMap.filenameCol] ?? ""));
        if (!stem) continue;
        const payload = wcpmRowToTagPayload(row, headerMap);
        if (!payload) continue;
        ins.run(stem, JSON.stringify(payload));
        n++;
      }
      return n;
    });
    const rowCount = insertAll();
    return { rowCount };
  } finally {
    db.close();
  }
}

function rebuildGenericExcelDb(excelPath: string, id: MusikverlagId): RebuildMusikverlagDbResult {
  const { sheetName, rows } = readFirstSheetRows(excelPath);
  const dbPath = sqlitePathForMusikverlag(id);
  const db = new Database(dbPath);
  try {
    db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE meta (
        k TEXT PRIMARY KEY NOT NULL,
        v TEXT NOT NULL
      );
      CREATE TABLE sheet_rows (
        row_idx INTEGER NOT NULL PRIMARY KEY,
        cells_json TEXT NOT NULL
      );
    `);
    const insMeta = db.prepare(`INSERT INTO meta (k, v) VALUES (?, ?)`);
    insMeta.run("format", "generic_excel_v1");
    insMeta.run("sheet_name", sheetName);

    const ins = db.prepare(`INSERT INTO sheet_rows (row_idx, cells_json) VALUES (?, ?)`);
    const insertAll = db.transaction((): number => {
      for (let i = 0; i < rows.length; i++) {
        ins.run(i, JSON.stringify(rows[i] ?? []));
      }
      return rows.length;
    });
    const rowCount = insertAll();
    return { rowCount };
  } finally {
    db.close();
  }
}

/** WCPM-Suche: Treffer über normalisierten Dateinamen-Stamm (wie bisher). */
export function lookupWcpmPayloadFromDb(fileName: string): WcpmTagPayload | null {
  const id: MusikverlagId = "wcpm";
  if (!musikverlagSqliteExists(id)) return null;
  const stem = wcpmFilenameStem(fileName);
  if (!stem) return null;
  const db = new Database(sqlitePathForMusikverlag(id), { readonly: true });
  try {
    const fmt = db.prepare("SELECT v FROM meta WHERE k = ?").get("format") as { v: string } | undefined;
    if (fmt?.v !== "wcpm_v1") return null;
    const row = db
      .prepare("SELECT payload_json FROM wcpm_tracks WHERE filename_stem = ?")
      .get(stem) as { payload_json: string } | undefined;
    if (!row?.payload_json) return null;
    return JSON.parse(row.payload_json) as WcpmTagPayload;
  } finally {
    db.close();
  }
}
