import type { Request, Response } from "express";
import { Router } from "express";
import { bearerAuth } from "./authMiddleware";

const BLANKFRAME_TRACK_MANY = "https://api.blankframe.com/track/get/many";

/**
 * Proxy zur Blankframe Track-API (vermeidet CORS; nur angemeldete Nutzer).
 * Query: `ids` = kommaseparierte Katalognummern (z. B. blkfr_0206-3).
 * Wird zu Kleinbuchstaben normalisiert (Upstream liefert bei BLKFR_… keinen Treffer).
 */
export function createBlankframeRouter(): Router {
  const r = Router();

  r.get("/blankframe/tracks", bearerAuth, async (req: Request, res: Response) => {
    const idsRaw = typeof req.query.ids === "string" ? req.query.ids.trim() : "";
    const ids = idsRaw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
      .join(",");
    if (!ids) {
      res.status(400).json({ error: "Parameter „ids“ fehlt (komma-separierte Katalognummern)." });
      return;
    }
    const url = `${BLANKFRAME_TRACK_MANY}?${new URLSearchParams({
      ids,
      altident: "true",
    }).toString()}`;
    try {
      const upstream = await fetch(url, {
        headers: { Accept: "application/json" },
      });
      const text = await upstream.text();
      if (!upstream.ok) {
        res.status(upstream.status).json({
          error: text.slice(0, 500) || `Blankframe-API (${upstream.status})`,
        });
        return;
      }
      let data: unknown;
      try {
        data = JSON.parse(text) as unknown;
      } catch {
        res.status(502).json({ error: "Ungültige JSON-Antwort von Blankframe." });
        return;
      }
      res.json(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Blankframe-API nicht erreichbar.";
      res.status(502).json({ error: msg });
    }
  });

  return r;
}
