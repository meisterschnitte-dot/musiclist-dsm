import type { Request, Response } from "express";
import { Router } from "express";
import { bearerAuth } from "./authMiddleware";

const SONOFIND_MMD = "https://www.sonofind.com/mmd/";

/** Öffentliches MMD-XML (CORS-Proxy für angemeldete Nutzer). */
export function createSonofindMmdRouter(): Router {
  const r = Router();

  r.get("/sonofind/mmd", bearerAuth, async (req: Request, res: Response) => {
    const raw = typeof req.query.trackcode === "string" ? req.query.trackcode.trim() : "";
    if (!raw) {
      res.status(400).json({ error: "Parameter „trackcode“ fehlt." });
      return;
    }
    if (raw.length < 6 || raw.length > 36) {
      res.status(400).json({ error: "Trackcode hat eine ungültige Länge." });
      return;
    }
    if (!/^[A-Za-z0-9-]+$/.test(raw)) {
      res.status(400).json({ error: "Trackcode enthält ungültige Zeichen." });
      return;
    }

    const url = `${SONOFIND_MMD}${encodeURIComponent(raw)}`;
    try {
      const upstream = await fetch(url, {
        headers: {
          Accept: "application/xml, text/xml;q=0.9, */*;q=0.8",
          "User-Agent": "Musiclist-DSM/1.0 (SonoFind-MMD-Proxy)",
        },
      });
      const text = await upstream.text();
      if (!upstream.ok) {
        res.status(upstream.status >= 400 ? upstream.status : 502).json({
          error: text.slice(0, 400) || `SonoFind (${upstream.status})`,
        });
        return;
      }
      if (!text.includes("<mmd") && !text.includes("mmd")) {
        res.status(502).json({ error: "Unerwartete Antwort von SonoFind (kein MMD-XML)." });
        return;
      }
      res.type("application/xml").send(text);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "SonoFind nicht erreichbar.";
      res.status(502).json({ error: msg });
    }
  });

  return r;
}
