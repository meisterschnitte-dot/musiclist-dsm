import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import multer from "multer";
import os from "node:os";
import path from "node:path";
import { MUSIKVERLAGE_CATALOG } from "../src/musikverlage/musikverlageCatalog";
import type { MusikverlagId } from "../src/musikverlage/musikverlageCatalog";
import { bearerAuth, requireAdmin } from "./authMiddleware";
import {
  assertMusikverlagId,
  findAnyUploadFile,
  hasUploadedXlsx,
  listUploadFiles,
  readMusikverlageConfig,
  removeUploadedXlsx,
  uploadPathForId,
  uploadDirForId,
  writeMusikverlageConfig,
  type MusikverlageConfigFile,
} from "./musikverlageFs";
import {
  countRowsInMusikverlagDb,
  listWcpmDbRows,
  lookupWcpmPayloadFromDb,
  musikverlagSqliteExists,
  rebuildMusikverlagTableDb,
  updateWcpmDbRow,
} from "./musikverlageSqlite";

const MAX_UPLOAD_MB = 250;

const uploadXlsx = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, os.tmpdir()),
    filename: (_req, file, cb) =>
      cb(null, `musikverlage-up-${Date.now()}-${process.pid}.xlsx`),
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const n = file.originalname.toLowerCase();
    if (n.endsWith(".xlsx") || n.endsWith(".xls") || n.endsWith(".csv")) {
      cb(null, true);
      return;
    }
    cb(new Error("Nur Tabellen-Dateien (.xlsx, .xls oder .csv)."));
  },
});

export function createMusikverlageRouter(): Router {
  const r = Router();

  r.get("/admin/musikverlage", bearerAuth, requireAdmin, async (_req: Request, res: Response) => {
    try {
      const cfg = await readMusikverlageConfig();
      const entries: Record<
        string,
        {
          apiBaseUrl?: string;
          xlsxFileName: string | null;
          xlsxUploadedAtIso: string | null;
          xlsxFileCount: number;
          xlsxFileNames: string[];
          hasFile: boolean;
          hasTableDb: boolean;
          tableDbRowCount: number | null;
        }
      > = {};
      for (const row of MUSIKVERLAGE_CATALOG) {
        const id = row.id;
        const st = cfg.entries[id];
        const onDisk = await hasUploadedXlsx(id);
        const files = await listUploadFiles(id);
        const uploadList = Array.isArray(st?.xlsxFiles) ? st.xlsxFiles : [];
        const latest = uploadList.length > 0 ? uploadList[uploadList.length - 1]! : null;
        const hasTableDb = musikverlagSqliteExists(id);
        const fileNames =
          uploadList.length > 0
            ? uploadList.map((x) => x.originalFileName)
            : st?.xlsxFileName
              ? [st.xlsxFileName]
              : [];
        entries[id] = {
          apiBaseUrl: typeof st?.apiBaseUrl === "string" ? st.apiBaseUrl : "",
          xlsxFileName: latest?.originalFileName ?? st?.xlsxFileName ?? null,
          xlsxUploadedAtIso: latest?.uploadedAtIso ?? st?.xlsxUploadedAtIso ?? null,
          xlsxFileCount: uploadList.length || files.length,
          xlsxFileNames: fileNames,
          hasFile: onDisk,
          hasTableDb,
          tableDbRowCount: hasTableDb ? countRowsInMusikverlagDb(id) : null,
        };
      }
      res.json({
        catalog: MUSIKVERLAGE_CATALOG.map((x) => ({
          id: x.id,
          label: x.label,
          hint: x.hint,
        })),
        entries,
      });
    } catch (e) {
      console.error("[musikverlage] GET", e);
      res.status(500).json({
        error: e instanceof Error ? e.message : "Konfiguration konnte nicht geladen werden.",
      });
    }
  });

  r.put("/admin/musikverlage", bearerAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, unknown>;
      const raw = body.entries;
      if (!raw || typeof raw !== "object") {
        res.status(400).json({ error: "entries muss ein Objekt sein." });
        return;
      }
      const current = await readMusikverlageConfig();
      const next: MusikverlageConfigFile = {
        version: 1,
        entries: { ...current.entries },
      };
      for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
        try {
          assertMusikverlagId(id);
        } catch {
          continue;
        }
        if (!v || typeof v !== "object") continue;
        const o = v as Record<string, unknown>;
        const api =
          typeof o.apiBaseUrl === "string" ? o.apiBaseUrl.trim() : "";
        const prev = next.entries[id] ?? {};
        next.entries[id] = {
          ...prev,
          apiBaseUrl: api.length ? api : undefined,
        };
      }
      await writeMusikverlageConfig(next);
      res.json({ ok: true });
    } catch (e) {
      console.error("[musikverlage] PUT", e);
      res.status(500).json({
        error: e instanceof Error ? e.message : "Speichern fehlgeschlagen.",
      });
    }
  });

  const uploadHandler = (
    mode: "replace" | "append",
    req: Request,
    res: Response
  ): Promise<void> =>
    (async () => {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!id) {
        res.status(400).json({ error: "Fehlende ID." });
        return;
      }
      try {
        assertMusikverlagId(id);
      } catch {
        res.status(400).json({ error: "Unbekannter Musikverlag." });
        return;
      }
      const file = (req as Request & { file?: Express.Multer.File }).file;
      if (!file?.path) {
        res.status(400).json({ error: "Keine Datei (Formularfeld file)." });
        return;
      }
      try {
        const fs = await import("node:fs/promises");
        const rawExt = path.extname(file.originalname).toLowerCase();
        const ext = rawExt === ".xls" ? ".xls" : rawExt === ".csv" ? ".csv" : ".xlsx";
        const now = new Date().toISOString();
        const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const dest = uploadPathForId(id as MusikverlagId, ext, stamp);
        const cfg = await readMusikverlageConfig();
        const prev = cfg.entries[id as MusikverlagId] ?? {};
        const prevFiles = Array.isArray(prev.xlsxFiles) ? prev.xlsxFiles : [];
        if (mode === "replace") {
          await removeUploadedXlsx(id as MusikverlagId);
        }
        await fs.mkdir(uploadDirForId(id as MusikverlagId), { recursive: true });
        await fs.copyFile(file.path, dest);
        await fs.unlink(file.path).catch(() => {});
        const storedFileName = path.basename(dest);
        const nextFiles =
          mode === "replace"
            ? [{ storedFileName, originalFileName: file.originalname || `${id}.xlsx`, uploadedAtIso: now }]
            : [
                ...prevFiles,
                { storedFileName, originalFileName: file.originalname || `${id}.xlsx`, uploadedAtIso: now },
              ];
        cfg.entries[id as MusikverlagId] = {
          ...prev,
          xlsxFileName: file.originalname || `${id}.xlsx`,
          xlsxUploadedAtIso: now,
          xlsxFiles: nextFiles,
        };
        await writeMusikverlageConfig(cfg);
        let tableIndexedRowCount = 0;
        try {
          const excelPaths = (await listUploadFiles(id as MusikverlagId)).filter((p) => {
            const pLower = p.toLowerCase();
            return pLower.endsWith(".xlsx") || pLower.endsWith(".xls") || pLower.endsWith(".csv");
          });
          const { rowCount } = rebuildMusikverlagTableDb(id as MusikverlagId, excelPaths);
          tableIndexedRowCount = rowCount;
        } catch (e) {
          await fs.unlink(dest).catch(() => {});
          cfg.entries[id as MusikverlagId] = prev;
          await writeMusikverlageConfig(cfg);
          throw e;
        }
        res.json({
          ok: true,
          mode,
          xlsxFileName: cfg.entries[id as MusikverlagId]!.xlsxFileName,
          xlsxUploadedAtIso: now,
          xlsxFileCount: cfg.entries[id as MusikverlagId]!.xlsxFiles?.length ?? 1,
          tableIndexedRowCount,
        });
      } catch (e) {
        console.error("[musikverlage] upload", e);
        res.status(500).json({
          error: e instanceof Error ? e.message : "Datei konnte nicht gespeichert werden.",
        });
      }
    })();

  const uploadMiddleware = (req: Request, res: Response, next: NextFunction): void => {
    uploadXlsx.single("file")(req, res, (err: unknown) => {
      if (err) {
        const m =
          err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "LIMIT_FILE_SIZE"
            ? `Datei zu gross. Maximal ${MAX_UPLOAD_MB} MB erlaubt.`
            : err instanceof Error
              ? err.message
              : String(err);
        res.status(400).json({ error: m || "Upload fehlgeschlagen." });
        return;
      }
      next();
    });
  };

  r.post("/admin/musikverlage/:id/upload", bearerAuth, requireAdmin, uploadMiddleware, async (req, res) => {
    await uploadHandler("replace", req, res);
  });

  r.post(
    "/admin/musikverlage/:id/upload-append",
    bearerAuth,
    requireAdmin,
    uploadMiddleware,
    async (req, res) => {
      await uploadHandler("append", req, res);
    }
  );

  r.get("/admin/musikverlage/:id/database", bearerAuth, requireAdmin, async (req: Request, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!id) {
      res.status(400).json({ error: "Fehlende ID." });
      return;
    }
    try {
      assertMusikverlagId(id);
      const filenameStem = typeof req.query.filenameStem === "string" ? req.query.filenameStem : "";
      const songTitle = typeof req.query.songTitle === "string" ? req.query.songTitle : "";
      const artist = typeof req.query.artist === "string" ? req.query.artist : "";
      const album = typeof req.query.album === "string" ? req.query.album : "";
      const composer = typeof req.query.composer === "string" ? req.query.composer : "";
      const isrc = typeof req.query.isrc === "string" ? req.query.isrc : "";
      const labelcode = typeof req.query.labelcode === "string" ? req.query.labelcode : "";
      const warnRaw = typeof req.query.warnung === "string" ? req.query.warnung.trim() : "";
      const warnung = warnRaw === "1" ? true : warnRaw === "0" ? false : null;
      const anyFilter = [
        filenameStem,
        songTitle,
        artist,
        album,
        composer,
        isrc,
        labelcode,
        warnRaw,
      ].some((s) => s.trim() !== "");
      if (!anyFilter) {
        res.json({ ok: true, rows: [], total: 0, filtered: false });
        return;
      }
      const result = listWcpmDbRows(id, {
        filenameStem,
        songTitle,
        artist,
        album,
        composer,
        isrc,
        labelcode,
        warnung,
      });
      res.json({ ok: true, rows: result.rows, total: result.total, filtered: true });
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : "Datenbankabfrage fehlgeschlagen.",
      });
    }
  });

  r.patch("/admin/musikverlage/:id/database/:rowKey", bearerAuth, requireAdmin, async (req: Request, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const rowKey = Array.isArray(req.params.rowKey) ? req.params.rowKey[0] : req.params.rowKey;
    if (!id || !rowKey) {
      res.status(400).json({ error: "Fehlende Parameter." });
      return;
    }
    try {
      assertMusikverlagId(id);
      const body = req.body as {
        songTitle?: string;
        artist?: string;
        album?: string;
        composer?: string;
        isrc?: string;
        labelcode?: string;
        warnung?: boolean;
      };
      const next = updateWcpmDbRow(id, decodeURIComponent(rowKey), {
        songTitle: body.songTitle,
        artist: body.artist,
        album: body.album,
        composer: body.composer,
        isrc: body.isrc,
        labelcode: body.labelcode,
        warnung: body.warnung,
      });
      res.json({ ok: true, payload: next });
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : "Speichern fehlgeschlagen.",
      });
    }
  });

  /**
   * WCPM-Excel (Verwaltung → Musikverlage → WCPM): Zeile per Dateiname (Spalte FILENAME; .wav/.mp3 egal).
   * Nur angemeldete Nutzer; GVL-Ergänzung im Client.
   */
  r.post("/musikverlage/wcpm/lookup", bearerAuth, async (req: Request, res: Response) => {
    const body = req.body as { fileName?: string };
    const fileName = typeof body.fileName === "string" ? body.fileName.trim() : "";
    if (!fileName) {
      res.status(400).json({ error: "fileName fehlt." });
      return;
    }
    const tablePath = await findAnyUploadFile("wcpm");
    if (!musikverlagSqliteExists("wcpm")) {
      if (tablePath) {
        try {
          const allPaths = await listUploadFiles("wcpm");
          rebuildMusikverlagTableDb("wcpm", allPaths.length ? allPaths : tablePath);
        } catch (e) {
          console.error("[musikverlage] wcpm db rebuild", e);
          res.status(500).json({
            error:
              e instanceof Error
                ? e.message
                : "WCPM-Datenbank konnte nicht aus der Excel-Datei erzeugt werden.",
          });
          return;
        }
      }
    }
    if (!musikverlagSqliteExists("wcpm")) {
      res.status(404).json({
        error: "Keine WCPM-Tabelle hochgeladen (Verwaltung → Musikverlage).",
      });
      return;
    }
    try {
      const payload = lookupWcpmPayloadFromDb(fileName);
      if (!payload) {
        res.status(404).json({
          error: "Kein Treffer für diesen Dateinamen in der WCPM-Tabelle.",
        });
        return;
      }
      res.json({ ok: true, payload });
    } catch (e) {
      console.error("[musikverlage] wcpm lookup", e);
      res.status(500).json({
        error: e instanceof Error ? e.message : "WCPM-Suche fehlgeschlagen.",
      });
    }
  });

  r.delete(
    "/admin/musikverlage/:id/upload",
    bearerAuth,
    requireAdmin,
    async (req: Request, res: Response) => {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!id) {
        res.status(400).json({ error: "Fehlende ID." });
        return;
      }
      try {
        assertMusikverlagId(id);
      } catch {
        res.status(400).json({ error: "Unbekannter Musikverlag." });
        return;
      }
      try {
        await removeUploadedXlsx(id as MusikverlagId);
        const cfg = await readMusikverlageConfig();
        const prev = cfg.entries[id as MusikverlagId] ?? {};
        cfg.entries[id as MusikverlagId] = {
          ...prev,
          xlsxFileName: null,
          xlsxUploadedAtIso: null,
          xlsxFiles: [],
        };
        await writeMusikverlageConfig(cfg);
        res.json({ ok: true });
      } catch (e) {
        console.error("[musikverlage] delete upload", e);
        res.status(500).json({
          error: e instanceof Error ? e.message : "Löschen fehlgeschlagen.",
        });
      }
    }
  );

  return r;
}
