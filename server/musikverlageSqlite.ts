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
export function rebuildMusikverlagTableDb(
  id: MusikverlagId,
  excelPathOrPaths: string | string[]
): RebuildMusikverlagDbResult {
  const excelPaths = Array.isArray(excelPathOrPaths) ? excelPathOrPaths : [excelPathOrPaths];
  if (excelPaths.length === 0) throw new Error("Keine Excel-Datei angegeben.");
  fs.mkdirSync(DB_DIR(), { recursive: true });
  removeMusikverlagSqliteDb(id);
  try {
    if (id === "wcpm") {
      return rebuildWcpmDb(excelPaths, id);
    }
    return rebuildGenericExcelDb(excelPaths, id);
  } catch (e) {
    removeMusikverlagSqliteDb(id);
    throw e;
  }
}

function readFirstSheetRows(excelPath: string): { sheetName: string; rows: unknown[][] } {
  const ext = path.extname(excelPath).toLowerCase();
  const wb =
    ext === ".csv"
      ? XLSX.readFile(excelPath, { type: "file", FS: ";" })
      : XLSX.readFile(excelPath);
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

function rebuildWcpmDb(excelPaths: string[], id: MusikverlagId): RebuildMusikverlagDbResult {
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
      for (const excelPath of excelPaths) {
        const { rows } = readFirstSheetRows(excelPath);
        if (!rows.length) {
          throw new Error(`WCPM-Tabelle ist leer: ${path.basename(excelPath)}`);
        }
        const headerMap = parseWcpmHeaderRow(rows[0]!);
        if (!headerMap) {
          throw new Error(`Unerwartete Kopfzeile in der WCPM-Tabelle: ${path.basename(excelPath)}`);
        }
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
      }
      return n;
    });
    const rowCount = insertAll();
    return { rowCount };
  } finally {
    db.close();
  }
}

function rebuildGenericExcelDb(excelPaths: string[], id: MusikverlagId): RebuildMusikverlagDbResult {
  const first = readFirstSheetRows(excelPaths[0]!);
  const sheetName = first.sheetName;
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
      let rowIdx = 0;
      for (const excelPath of excelPaths) {
        const { rows } = readFirstSheetRows(excelPath);
        for (let i = 0; i < rows.length; i++) {
          ins.run(rowIdx, JSON.stringify(rows[i] ?? []));
          rowIdx++;
        }
      }
      return rowIdx;
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

export type WcpmDbFilters = {
  filenameStem?: string;
  songTitle?: string;
  artist?: string;
  album?: string;
  composer?: string;
  isrc?: string;
  labelcode?: string;
  warnung?: boolean | null;
};

export type WcpmDbBrowserRow = {
  filenameStem: string;
  payload: WcpmTagPayload;
};

export function listWcpmDbRows(
  id: MusikverlagId,
  filters: WcpmDbFilters,
  limit: number = 500
): { rows: WcpmDbBrowserRow[]; total: number } {
  if (!musikverlagSqliteExists(id)) return { rows: [], total: 0 };
  const db = new Database(sqlitePathForMusikverlag(id), { readonly: true });
  try {
    const fmt = db.prepare("SELECT v FROM meta WHERE k = ?").get("format") as { v: string } | undefined;
    if (fmt?.v !== "wcpm_v1") {
      throw new Error("Datenbankansicht ist aktuell nur für WCPM verfügbar.");
    }
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    const addLike = (jsonPathOrColumn: string, value: string, isColumn = false) => {
      const v = value.trim().toLowerCase();
      if (!v) return;
      clauses.push(
        isColumn
          ? `LOWER(${jsonPathOrColumn}) LIKE ?`
          : `LOWER(COALESCE(json_extract(payload_json, '${jsonPathOrColumn}'), '')) LIKE ?`
      );
      params.push(`%${v}%`);
    };
    addLike("filename_stem", filters.filenameStem ?? "", true);
    addLike("$.songTitle", filters.songTitle ?? "");
    addLike("$.artist", filters.artist ?? "");
    addLike("$.album", filters.album ?? "");
    addLike("$.composer", filters.composer ?? "");
    addLike("$.isrc", filters.isrc ?? "");
    addLike("$.labelcode", filters.labelcode ?? "");
    if (filters.warnung === true) clauses.push(`json_extract(payload_json, '$.warnung') = 1`);
    else if (filters.warnung === false) {
      clauses.push(`(json_extract(payload_json, '$.warnung') IS NULL OR json_extract(payload_json, '$.warnung') = 0)`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const totalSql = `SELECT COUNT(*) AS c FROM wcpm_tracks ${where}`;
    const totalRow = db.prepare(totalSql).get(...params) as { c: number };
    const listSql = `
      SELECT filename_stem, payload_json
      FROM wcpm_tracks
      ${where}
      ORDER BY filename_stem ASC
      LIMIT ?
    `;
    const listRows = db.prepare(listSql).all(...params, Math.max(1, Math.min(5000, limit))) as {
      filename_stem: string;
      payload_json: string;
    }[];
    const rows: WcpmDbBrowserRow[] = [];
    for (const r of listRows) {
      try {
        const payload = JSON.parse(r.payload_json) as WcpmTagPayload;
        rows.push({ filenameStem: r.filename_stem, payload });
      } catch {
        rows.push({
          filenameStem: r.filename_stem,
          payload: { songTitle: "", artist: "", album: "", composer: "", isrc: "", labelcode: "" },
        });
      }
    }
    return { rows, total: totalRow.c };
  } finally {
    db.close();
  }
}

export function updateWcpmDbRow(
  id: MusikverlagId,
  filenameStem: string,
  patch: Partial<WcpmTagPayload>
): WcpmTagPayload {
  if (!musikverlagSqliteExists(id)) throw new Error("Keine Datenbank vorhanden.");
  const key = filenameStem.trim().toLowerCase();
  if (!key) throw new Error("Dateiname (Stamm) fehlt.");
  const db = new Database(sqlitePathForMusikverlag(id));
  try {
    const fmt = db.prepare("SELECT v FROM meta WHERE k = ?").get("format") as { v: string } | undefined;
    if (fmt?.v !== "wcpm_v1") {
      throw new Error("Datenbankbearbeitung ist aktuell nur für WCPM verfügbar.");
    }
    const row = db
      .prepare("SELECT payload_json FROM wcpm_tracks WHERE filename_stem = ?")
      .get(key) as { payload_json: string } | undefined;
    if (!row?.payload_json) throw new Error("Eintrag nicht gefunden.");
    const prev = JSON.parse(row.payload_json) as WcpmTagPayload;
    const next: WcpmTagPayload = { ...prev };
    const stringKeys: (keyof Omit<WcpmTagPayload, "warnung">)[] = [
      "songTitle",
      "artist",
      "album",
      "composer",
      "isrc",
      "labelcode",
    ];
    for (const k of stringKeys) {
      if (!(k in patch)) continue;
      const raw = patch[k];
      const v = typeof raw === "string" ? raw.trim() : "";
      next[k] = v;
    }
    if ("warnung" in patch) {
      next.warnung = patch.warnung === true ? true : false;
    }
    db.prepare("INSERT OR REPLACE INTO wcpm_tracks (filename_stem, payload_json) VALUES (?, ?)").run(
      key,
      JSON.stringify(next)
    );
    return next;
  } finally {
    db.close();
  }
}
