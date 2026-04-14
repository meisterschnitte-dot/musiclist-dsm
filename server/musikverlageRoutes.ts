import type { Request, Response } from "express";
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
  readMusikverlageConfig,
  removeUploadedXlsx,
  uploadPathForId,
  writeMusikverlageConfig,
  type MusikverlageConfigFile,
} from "./musikverlageFs";
import {
  countRowsInMusikverlagDb,
  lookupWcpmPayloadFromDb,
  musikverlagSqliteExists,
  rebuildMusikverlagTableDb,
} from "./musikverlageSqlite";

const uploadXlsx = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, os.tmpdir()),
    filename: (_req, file, cb) =>
      cb(null, `musikverlage-up-${Date.now()}-${process.pid}.xlsx`),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const n = file.originalname.toLowerCase();
    if (n.endsWith(".xlsx") || n.endsWith(".xls")) {
      cb(null, true);
      return;
    }
    cb(new Error("Nur Excel-Dateien (.xlsx oder .xls)."));
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
          hasFile: boolean;
          hasTableDb: boolean;
          tableDbRowCount: number | null;
        }
      > = {};
      for (const row of MUSIKVERLAGE_CATALOG) {
        const id = row.id;
        const st = cfg.entries[id];
        const onDisk = await hasUploadedXlsx(id);
        const hasTableDb = musikverlagSqliteExists(id);
        entries[id] = {
          apiBaseUrl: typeof st?.apiBaseUrl === "string" ? st.apiBaseUrl : "",
          xlsxFileName: st?.xlsxFileName ?? null,
          xlsxUploadedAtIso: st?.xlsxUploadedAtIso ?? null,
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

  r.post(
    "/admin/musikverlage/:id/upload",
    bearerAuth,
    requireAdmin,
    (req, res, next) => {
      uploadXlsx.single("file")(req, res, (err: unknown) => {
        if (err) {
          const m = err instanceof Error ? err.message : String(err);
          res.status(400).json({ error: m || "Upload fehlgeschlagen." });
          return;
        }
        next();
      });
    },
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
      const file = (req as Request & { file?: Express.Multer.File }).file;
      if (!file?.path) {
        res.status(400).json({ error: "Keine Datei (Formularfeld file)." });
        return;
      }
      try {
        const fs = await import("node:fs/promises");
        const ext = path.extname(file.originalname).toLowerCase() === ".xls" ? ".xls" : ".xlsx";
        await removeUploadedXlsx(id as MusikverlagId);
        const dest = uploadPathForId(id as MusikverlagId, ext);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.copyFile(file.path, dest);
        await fs.unlink(file.path).catch(() => {});
        const now = new Date().toISOString();
        const cfg = await readMusikverlageConfig();
        const prev = cfg.entries[id as MusikverlagId] ?? {};
        cfg.entries[id as MusikverlagId] = {
          ...prev,
          xlsxFileName: file.originalname || `${id}.xlsx`,
          xlsxUploadedAtIso: now,
        };
        await writeMusikverlageConfig(cfg);
        let tableIndexedRowCount = 0;
        try {
          const { rowCount } = rebuildMusikverlagTableDb(id as MusikverlagId, dest);
          tableIndexedRowCount = rowCount;
        } catch (e) {
          await fs.unlink(dest).catch(() => {});
          await removeUploadedXlsx(id as MusikverlagId).catch(() => {});
          cfg.entries[id as MusikverlagId] = prev;
          await writeMusikverlageConfig(cfg);
          throw e;
        }
        res.json({
          ok: true,
          xlsxFileName: cfg.entries[id as MusikverlagId]!.xlsxFileName,
          xlsxUploadedAtIso: now,
          tableIndexedRowCount,
        });
      } catch (e) {
        console.error("[musikverlage] upload", e);
        res.status(500).json({
          error: e instanceof Error ? e.message : "Datei konnte nicht gespeichert werden.",
        });
      }
    }
  );

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
          rebuildMusikverlagTableDb("wcpm", tablePath);
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
