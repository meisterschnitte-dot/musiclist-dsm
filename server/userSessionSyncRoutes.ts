import type { Request, Response } from "express";
import { Router } from "express";
import { bearerAuth } from "./authMiddleware";
import { readUserSessionFile, writeUserSessionFile } from "./userSessionSyncFs";

export function createUserSessionSyncRouter(): Router {
  const r = Router();

  r.get("/me/session-sync", bearerAuth, async (req: Request, res: Response) => {
    try {
      const uid = req.authUser!.id;
      const data = await readUserSessionFile(uid);
      if (!data) {
        res.json({ updatedAt: null, workspace: null, tagStore: null });
        return;
      }
      res.json({
        updatedAt: data.updatedAt,
        workspace: data.workspace,
        tagStore: data.tagStore,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Lesen fehlgeschlagen.";
      res.status(500).json({ error: msg });
    }
  });

  r.put("/me/session-sync", bearerAuth, async (req: Request, res: Response) => {
    try {
      const uid = req.authUser!.id;
      const body = req.body;
      if (!body || typeof body !== "object") {
        res.status(400).json({ error: "Ungültige Anfrage." });
        return;
      }
      const workspace = (body as { workspace?: unknown }).workspace;
      const tagStore = (body as { tagStore?: unknown }).tagStore;
      const force = (body as { force?: unknown }).force === true;
      const clientIdRaw = (body as { clientId?: unknown }).clientId;
      const clientId = typeof clientIdRaw === "string" ? clientIdRaw.trim().slice(0, 128) : "";
      const baseRaw = (body as { baseUpdatedAt?: unknown }).baseUpdatedAt;
      let baseUpdatedAt: string | null | undefined;
      if (baseRaw === undefined) {
        baseUpdatedAt = undefined;
      } else if (baseRaw === null) {
        baseUpdatedAt = null;
      } else if (typeof baseRaw === "string") {
        baseUpdatedAt = baseRaw;
      } else {
        res.status(400).json({ error: "baseUpdatedAt muss ein ISO-Zeitstempel oder null sein." });
        return;
      }
      if (workspace !== undefined && workspace !== null && typeof workspace !== "object") {
        res.status(400).json({ error: "workspace muss ein Objekt sein." });
        return;
      }
      if (tagStore !== undefined && tagStore !== null && typeof tagStore !== "object") {
        res.status(400).json({ error: "tagStore muss ein Objekt sein." });
        return;
      }
      const payload = {
        workspace: workspace === undefined ? null : workspace,
        tagStore: tagStore === undefined ? null : tagStore,
        ...(clientId ? { clientId } : {}),
      };

      if (!force) {
        const existing = await readUserSessionFile(uid);
        if (existing) {
          if (baseUpdatedAt === undefined) {
            /* ältere Clients ohne Versionsprüfung */
          } else if (existing.updatedAt !== baseUpdatedAt) {
            res.status(409).json({
              error:
                "Die Sitzung wurde inzwischen woanders gespeichert. Bitte wählen Sie, welchen Stand Sie behalten möchten.",
              conflict: true,
              updatedAt: existing.updatedAt,
              workspace: existing.workspace,
              tagStore: existing.tagStore,
            });
            return;
          }
        }
      }

      const saved = await writeUserSessionFile(uid, payload);
      res.json({
        updatedAt: saved.updatedAt,
        workspace: saved.workspace,
        tagStore: saved.tagStore,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Speichern fehlgeschlagen.";
      res.status(500).json({ error: msg });
    }
  });

  return r;
}
