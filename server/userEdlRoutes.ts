import type { Request, Response } from "express";
import { Router } from "express";
import { bearerAuth } from "./authMiddleware";
import {
  deleteUserEdlDirectory,
  deleteUserEdlFile,
  ensureUserEdlRoot,
  listUserEdlDirectory,
  mkdirUserEdl,
  moveUserEdlFile,
  readUserEdlFileBuffer,
  readUserEdlFileText,
  renameUserEdlSubdirectory,
  writeUserEdlFileBuffer,
  writeUserEdlFileText,
} from "./userEdlFs";

function segmentsBody(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const s = (body as { segments?: unknown }).segments;
  if (!Array.isArray(s)) return [];
  return s.filter((x): x is string => typeof x === "string");
}

function parentSegmentsBody(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const s = (body as { parentSegments?: unknown }).parentSegments;
  if (!Array.isArray(s)) return [];
  return s.filter((x): x is string => typeof x === "string");
}

function pathSegmentsBody(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const s = (body as { pathSegments?: unknown }).pathSegments;
  if (!Array.isArray(s)) return [];
  return s.filter((x): x is string => typeof x === "string");
}

export function createUserEdlRouter(): Router {
  const r = Router();

  r.use(bearerAuth);

  r.post("/me/edl/list", async (req: Request, res: Response) => {
    try {
      const uid = req.authUser!.id;
      await ensureUserEdlRoot(uid);
      const segments = segmentsBody(req.body);
      const entries = await listUserEdlDirectory(uid, segments);
      res.json({ entries });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "Liste fehlgeschlagen." });
    }
  });

  r.post("/me/edl/read-text", async (req: Request, res: Response) => {
    try {
      const uid = req.authUser!.id;
      const segments = segmentsBody(req.body);
      const fileName = typeof req.body?.fileName === "string" ? req.body.fileName : "";
      if (!fileName) {
        res.status(400).json({ error: "fileName fehlt." });
        return;
      }
      const text = await readUserEdlFileText(uid, segments, fileName);
      res.json({ text });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "Lesen fehlgeschlagen." });
    }
  });

  r.post("/me/edl/read-binary", async (req: Request, res: Response) => {
    try {
      const uid = req.authUser!.id;
      const segments = segmentsBody(req.body);
      const fileName = typeof req.body?.fileName === "string" ? req.body.fileName : "";
      if (!fileName) {
        res.status(400).json({ error: "fileName fehlt." });
        return;
      }
      const buf = await readUserEdlFileBuffer(uid, segments, fileName);
      res.json({ base64: buf.toString("base64") });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "Lesen fehlgeschlagen." });
    }
  });

  r.post("/me/edl/write-text", async (req: Request, res: Response) => {
    try {
      const uid = req.authUser!.id;
      const segments = segmentsBody(req.body);
      const fileName = typeof req.body?.fileName === "string" ? req.body.fileName : "";
      const text = typeof req.body?.text === "string" ? req.body.text : "";
      if (!fileName) {
        res.status(400).json({ error: "fileName fehlt." });
        return;
      }
      await writeUserEdlFileText(uid, segments, fileName, text);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "Schreiben fehlgeschlagen." });
    }
  });

  r.post("/me/edl/write-binary", async (req: Request, res: Response) => {
    try {
      const uid = req.authUser!.id;
      const segments = segmentsBody(req.body);
      const fileName = typeof req.body?.fileName === "string" ? req.body.fileName : "";
      const base64 = typeof req.body?.base64 === "string" ? req.body.base64 : "";
      if (!fileName || !base64) {
        res.status(400).json({ error: "fileName und base64 sind erforderlich." });
        return;
      }
      const buf = Buffer.from(base64, "base64");
      await writeUserEdlFileBuffer(uid, segments, fileName, buf);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "Schreiben fehlgeschlagen." });
    }
  });

  r.post("/me/edl/mkdir", async (req: Request, res: Response) => {
    try {
      const uid = req.authUser!.id;
      const parentSegments = parentSegmentsBody(req.body);
      const name = typeof req.body?.name === "string" ? req.body.name : "";
      if (!name) {
        res.status(400).json({ error: "name fehlt." });
        return;
      }
      await mkdirUserEdl(uid, parentSegments, name);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "Ordner fehlgeschlagen." });
    }
  });

  r.post("/me/edl/move-file", async (req: Request, res: Response) => {
    try {
      const uid = req.authUser!.id;
      const fromSegments = Array.isArray(req.body?.fromSegments)
        ? (req.body.fromSegments as unknown[]).filter((x): x is string => typeof x === "string")
        : [];
      const toSegments = Array.isArray(req.body?.toSegments)
        ? (req.body.toSegments as unknown[]).filter((x): x is string => typeof x === "string")
        : [];
      const fileName = typeof req.body?.fileName === "string" ? req.body.fileName : "";
      if (!fileName) {
        res.status(400).json({ error: "fileName fehlt." });
        return;
      }
      await moveUserEdlFile(uid, fromSegments, fileName, toSegments);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "Verschieben fehlgeschlagen." });
    }
  });

  r.post("/me/edl/delete-file", async (req: Request, res: Response) => {
    try {
      const uid = req.authUser!.id;
      const segments = segmentsBody(req.body);
      const fileName = typeof req.body?.fileName === "string" ? req.body.fileName : "";
      if (!fileName) {
        res.status(400).json({ error: "fileName fehlt." });
        return;
      }
      await deleteUserEdlFile(uid, segments, fileName);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "Löschen fehlgeschlagen." });
    }
  });

  r.post("/me/edl/delete-directory", async (req: Request, res: Response) => {
    try {
      const uid = req.authUser!.id;
      const pathSegments = pathSegmentsBody(req.body);
      if (pathSegments.length === 0) {
        res.status(400).json({ error: "Wurzel kann nicht gelöscht werden." });
        return;
      }
      await deleteUserEdlDirectory(uid, pathSegments);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "Löschen fehlgeschlagen." });
    }
  });

  r.post("/me/edl/rename-directory", async (req: Request, res: Response) => {
    try {
      const uid = req.authUser!.id;
      const parentSegments = parentSegmentsBody(req.body);
      const oldName = typeof req.body?.oldName === "string" ? req.body.oldName : "";
      const newName = typeof req.body?.newName === "string" ? req.body.newName : "";
      if (!oldName || !newName) {
        res.status(400).json({ error: "oldName und newName sind erforderlich." });
        return;
      }
      await renameUserEdlSubdirectory(uid, parentSegments, oldName, newName);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "Umbenennen fehlgeschlagen." });
    }
  });

  return r;
}
