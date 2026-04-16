import type { Request, Response } from "express";
import { Router } from "express";
import { bearerAuth, requireAdmin } from "./authMiddleware";
import {
  deleteSharedMp3File,
  getMergedMusicDatabaseState,
  readSharedMp3Buffer,
  registerMusicDatabasePaths,
  removeMusicDatabaseIndexPaths,
  sharedMp3FileExists,
  touchMusicDbTagEdited,
  writeSharedMp3Buffer,
} from "./sharedTracksFs";
import { parseGvlLabelDb, readGvlLabelDb, writeGvlLabelDb } from "./gvlLabelFs";

function relativePathBody(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const p = (body as { relativePath?: unknown }).relativePath;
  return typeof p === "string" ? p : "";
}

function pathsArrayBody(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const p = (body as { paths?: unknown }).paths;
  if (!Array.isArray(p)) return [];
  return p.filter((x): x is string => typeof x === "string");
}

function gvlDbBody(body: unknown) {
  if (!body || typeof body !== "object") return null;
  const db = (body as { db?: unknown }).db;
  return parseGvlLabelDb(db);
}

export function createSharedTracksRouter(): Router {
  const r = Router();
  r.use(bearerAuth);

  /** Installationsweite GVL-Label-Liste (PDF-Import), gemeinsam für alle Benutzer. */
  r.post("/shared/gvl-label-db", async (_req: Request, res: Response) => {
    try {
      const db = await readGvlLabelDb();
      res.json({ db });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "Lesen fehlgeschlagen." });
    }
  });

  r.post("/shared/gvl-label-db/save", requireAdmin, async (req: Request, res: Response) => {
    try {
      const db = gvlDbBody(req.body);
      if (!db) {
        res.status(400).json({ error: "Ungültige GVL-Daten (db)." });
        return;
      }
      await writeGvlLabelDb(db);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "Speichern fehlgeschlagen." });
    }
  });

  /** Installationsweite Musikdatenbank: Pfade (Index ∪ Dateisystem) und Zeitstempel. */
  r.post("/shared/music-db", async (_req: Request, res: Response) => {
    try {
      const state = await getMergedMusicDatabaseState();
      res.json({ paths: state.paths, metadata: state.metadata });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "Lesen fehlgeschlagen." });
    }
  });

  /** Zusätzliche Pfade ins Index-Register (z. B. aus Playlist-Verknüpfungen). */
  r.post("/shared/music-db/register", requireAdmin, async (req: Request, res: Response) => {
    try {
      const paths = pathsArrayBody(req.body);
      const merged = await registerMusicDatabasePaths(paths);
      res.json({ paths: merged.paths, metadata: merged.metadata });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "Speichern fehlgeschlagen." });
    }
  });

  /** Index-Einträge entfernen (kein Dateisystem-Löschen). */
  r.post("/shared/music-db/remove-paths", requireAdmin, async (req: Request, res: Response) => {
    try {
      const paths = pathsArrayBody(req.body);
      const merged = await removeMusicDatabaseIndexPaths(paths);
      res.json({ paths: merged.paths, metadata: merged.metadata });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "Aktualisierung fehlgeschlagen." });
    }
  });

  /** Nach ID3-Änderung: Bearbeitungsdatum der Zeile aktualisieren. */
  r.post("/shared/music-db/touch-tag-edited", requireAdmin, async (req: Request, res: Response) => {
    try {
      const relativePath = relativePathBody(req.body);
      if (!relativePath) {
        res.status(400).json({ error: "relativePath fehlt." });
        return;
      }
      const entry = await touchMusicDbTagEdited(relativePath);
      res.json({ ok: true, entry });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "Aktualisierung fehlgeschlagen." });
    }
  });

  r.post("/shared/tracks/read-binary", async (req: Request, res: Response) => {
    try {
      const relativePath = relativePathBody(req.body);
      if (!relativePath) {
        res.status(400).json({ error: "relativePath fehlt." });
        return;
      }
      const buf = await readSharedMp3Buffer(relativePath);
      res.json({ base64: buf.toString("base64") });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "Lesen fehlgeschlagen." });
    }
  });

  r.post("/shared/tracks/exists", async (req: Request, res: Response) => {
    try {
      const relativePath = relativePathBody(req.body);
      if (!relativePath) {
        res.status(400).json({ error: "relativePath fehlt." });
        return;
      }
      const exists = await sharedMp3FileExists(relativePath);
      res.json({ exists });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "Prüfung fehlgeschlagen." });
    }
  });

  r.post("/shared/tracks/write-binary", requireAdmin, async (req: Request, res: Response) => {
    try {
      const relativePath = relativePathBody(req.body);
      const base64 = typeof req.body?.base64 === "string" ? req.body.base64 : "";
      if (!relativePath || !base64) {
        res.status(400).json({ error: "relativePath und base64 sind erforderlich." });
        return;
      }
      const buf = Buffer.from(base64, "base64");
      await writeSharedMp3Buffer(relativePath, buf);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "Schreiben fehlgeschlagen." });
    }
  });

  r.post("/shared/tracks/delete-file", requireAdmin, async (req: Request, res: Response) => {
    try {
      const relativePath = relativePathBody(req.body);
      if (!relativePath) {
        res.status(400).json({ error: "relativePath fehlt." });
        return;
      }
      await deleteSharedMp3File(relativePath);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "Löschen fehlgeschlagen." });
    }
  });

  return r;
}
