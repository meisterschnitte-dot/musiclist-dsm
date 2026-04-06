import type { Request, Response } from "express";
import { Router } from "express";
import { bearerAuth, requireAdmin } from "./authMiddleware";
import type { PlaylistLibraryRef } from "./customerPlaylistAssignmentsFs";
import {
  getPlaylistPendingCustomerForRef,
  registerPlaylistPending,
} from "./customerPlaylistPendingFs";
import {
  readCustomersDb,
  writeCustomersDb,
  normalizeCustomer,
  type CustomerRecord,
} from "./customersFs";

function parsePlaylistLibraryRefBody(body: unknown): PlaylistLibraryRef | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  const libraryOwnerUserId =
    typeof o.libraryOwnerUserId === "string" ? o.libraryOwnerUserId.trim() : "";
  const fileName = typeof o.fileName === "string" ? o.fileName.trim() : "";
  const ps = o.parentSegments;
  const parentSegments = Array.isArray(ps) ? ps.filter((x): x is string => typeof x === "string") : [];
  if (!libraryOwnerUserId || !fileName) return null;
  return { libraryOwnerUserId, parentSegments, fileName };
}

export function createCustomersRouter(): Router {
  const r = Router();

  r.get("/customers", bearerAuth, requireAdmin, async (_req: Request, res: Response) => {
    try {
      const db = await readCustomersDb();
      res.json({ customers: db.customers });
    } catch (e) {
      console.error("[customers]", e);
      res.status(500).json({ error: "Kunden konnten nicht geladen werden." });
    }
  });

  r.post("/customers", bearerAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const body = req.body as Partial<CustomerRecord>;
      const c = normalizeCustomer(body);
      if (!c) {
        res.status(400).json({ error: "Ein Kundenname (Firmenname) ist erforderlich." });
        return;
      }
      const db = await readCustomersDb();
      db.customers.push(c);
      await writeCustomersDb(db);
      res.json({ customer: c });
    } catch (e) {
      console.error("[customers]", e);
      res.status(500).json({ error: "Kunde konnte nicht angelegt werden." });
    }
  });

  r.put("/customers/:id", bearerAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = typeof req.params.id === "string" ? req.params.id.trim() : "";
      const body = req.body as Partial<CustomerRecord>;
      const c = normalizeCustomer({ ...body, id });
      if (!c || c.id !== id) {
        res.status(400).json({ error: "Ungültige Kundendaten." });
        return;
      }
      const db = await readCustomersDb();
      const i = db.customers.findIndex((x) => x.id === id);
      if (i < 0) {
        res.status(404).json({ error: "Kunde nicht gefunden." });
        return;
      }
      db.customers[i] = c;
      await writeCustomersDb(db);
      res.json({ customer: c });
    } catch (e) {
      console.error("[customers]", e);
      res.status(500).json({ error: "Kunde konnte nicht gespeichert werden." });
    }
  });

  r.delete("/customers/:id", bearerAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = typeof req.params.id === "string" ? req.params.id.trim() : "";
      const db = await readCustomersDb();
      const next = db.customers.filter((x) => x.id !== id);
      if (next.length === db.customers.length) {
        res.status(404).json({ error: "Kunde nicht gefunden." });
        return;
      }
      await writeCustomersDb({ customers: next });
      res.json({ ok: true });
    } catch (e) {
      console.error("[customers]", e);
      res.status(500).json({ error: "Kunde konnte nicht gelöscht werden." });
    }
  });

  /** Nach Transfer: .list dem Kunden vormerken (noch nicht im Kunden-Browser sichtbar). */
  r.post("/playlist-pending/register", bearerAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const customerId = typeof req.body?.customerId === "string" ? req.body.customerId.trim() : "";
      const ref = parsePlaylistLibraryRefBody(req.body);
      if (!customerId || !ref) {
        res.status(400).json({ error: "customerId und Bibliotheksreferenz (libraryOwnerUserId, parentSegments, fileName) sind erforderlich." });
        return;
      }
      await registerPlaylistPending(customerId, ref);
      res.json({ ok: true });
    } catch (e) {
      console.error("[playlist-pending register]", e);
      res.status(500).json({ error: "Vormerkung konnte nicht gespeichert werden." });
    }
  });

  /** Für Mail-Dialog: gespeicherten Kunden zur .list lesen. */
  r.post("/playlist-pending/lookup", bearerAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const ref = parsePlaylistLibraryRefBody(req.body);
      if (!ref) {
        res.status(400).json({ error: "Ungültige Bibliotheksreferenz." });
        return;
      }
      const customerId = await getPlaylistPendingCustomerForRef(ref);
      res.json({ customerId: customerId ?? null });
    } catch (e) {
      console.error("[playlist-pending lookup]", e);
      res.status(500).json({ error: "Vormerkung konnte nicht gelesen werden." });
    }
  });

  return r;
}
