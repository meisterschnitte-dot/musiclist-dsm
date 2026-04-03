import type { Request, Response } from "express";
import { Router } from "express";
import { bearerAuth, requireAdmin } from "./authMiddleware";
import {
  deleteSharedMp3File,
  getMergedMusicDatabasePaths,
  readSharedMp3Buffer,
  registerMusicDatabasePaths,
  removeMusicDatabaseIndexPaths,
  sharedMp3FileExists,
  writeSharedMp3Buffer,
} from "./sharedTracksFs";

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

export function createSharedTracksRouter(): Router {
  const r = Router();
  r.use(bearerAuth);

  /** Installationsweite Musikdatenbank-Pfade (Index ∪ Dateisystem). */
  r.post("/shared/music-db", async (_req: Request, res: Response) => {
    try {
      const paths = await getMergedMusicDatabasePaths();
      res.json({ paths });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "Lesen fehlgeschlagen." });
    }
  });

  /** Zusätzliche Pfade ins Index-Register (z. B. aus Playlist-Verknüpfungen). */
  r.post("/shared/music-db/register", async (req: Request, res: Response) => {
    try {
      const paths = pathsArrayBody(req.body);
      const merged = await registerMusicDatabasePaths(paths);
      res.json({ paths: merged });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "Speichern fehlgeschlagen." });
    }
  });

  /** Index-Einträge entfernen (kein Dateisystem-Löschen). */
  r.post("/shared/music-db/remove-paths", async (req: Request, res: Response) => {
    try {
      const paths = pathsArrayBody(req.body);
      const merged = await removeMusicDatabaseIndexPaths(paths);
      res.json({ paths: merged });
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

  r.post("/shared/tracks/write-binary", async (req: Request, res: Response) => {
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
