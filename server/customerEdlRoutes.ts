import type { Request, Response } from "express";
import { Router } from "express";
import { bearerAuth, requireCustomerRole } from "./authMiddleware";
import { isUserEmailInCustomerDirectory } from "./customersFs";
import {
  getAssignmentsForCustomer,
  removePlaylistAssignmentForCustomer,
  type PlaylistLibraryRef,
} from "./customerPlaylistAssignmentsFs";
import {
  listUserEdlDirectory,
  readUserEdlFileBuffer,
  readUserEdlFileText,
} from "./userEdlFs";

type CustomerEdlAccess =
  | { ok: false; mode: "no_customer" }
  | { ok: false; mode: "email_not_in_customer_list" }
  | { ok: true; customerId: string; assignments: PlaylistLibraryRef[] };

async function resolveCustomerEdlAccess(req: Request): Promise<CustomerEdlAccess> {
  const u = req.authUser!;
  const customerId = u.customerId?.trim() ?? "";
  if (!customerId) return { ok: false, mode: "no_customer" };
  const allowed = await isUserEmailInCustomerDirectory(customerId, u.email);
  if (!allowed) return { ok: false, mode: "email_not_in_customer_list" };
  const assignments = await getAssignmentsForCustomer(customerId);
  return { ok: true, customerId, assignments };
}

function respondCustomerEdlForbidden(
  res: Response,
  mode: Exclude<CustomerEdlAccess, { ok: true }>["mode"]
): void {
  if (mode === "no_customer") {
    res.status(403).json({ error: "Kein Kunde zugeordnet." });
    return;
  }
  res.status(403).json({
    error:
      "Kein Zugriff: Diese E-Mail-Adresse ist der Kundenliste nicht zugeordnet. Bitte Administrator kontaktieren.",
  });
}

function segmentsBody(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const s = (body as { segments?: unknown }).segments;
  if (!Array.isArray(s)) return [];
  return s.filter((x): x is string => typeof x === "string");
}

function pathSegmentsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((s, i) => s === b[i]);
}

function isPrefix(prefix: string[], full: string[]): boolean {
  if (prefix.length > full.length) return false;
  return prefix.every((s, i) => s === full[i]);
}

function allowedNamesAt(
  ownerId: string,
  segments: string[],
  assignments: PlaylistLibraryRef[]
): Set<string> {
  const out = new Set<string>();
  for (const a of assignments) {
    if (a.libraryOwnerUserId !== ownerId) continue;
    const parent = a.parentSegments;
    if (!isPrefix(segments, parent)) continue;
    if (segments.length < parent.length) {
      const next = parent[segments.length];
      if (next) out.add(next);
    } else if (segments.length === parent.length && pathSegmentsEqual(segments, parent)) {
      out.add(a.fileName);
    }
  }
  return out;
}

function ownerLabel(ownerId: string): string {
  return "Musiclist";
}

function canReadFile(
  customerId: string,
  ownerId: string,
  parentSegments: string[],
  fileName: string,
  assignments: PlaylistLibraryRef[]
): boolean {
  return assignments.some(
    (a) =>
      a.libraryOwnerUserId === ownerId &&
      pathSegmentsEqual(a.parentSegments, parentSegments) &&
      a.fileName === fileName
  );
}

export function createCustomerEdlRouter(): Router {
  const r = Router();

  r.post("/customer/edl/list", bearerAuth, requireCustomerRole, async (req: Request, res: Response) => {
    try {
      const access = await resolveCustomerEdlAccess(req);
      if (!access.ok) {
        res.json({ entries: [] });
        return;
      }
      const { assignments } = access;
      const segments = segmentsBody(req.body);

      if (segments.length === 0) {
        const owners = [...new Set(assignments.map((a) => a.libraryOwnerUserId))];
        const entries = owners.map((name) => ({
          name,
          kind: "directory" as const,
          label: ownerLabel(name),
        }));
        res.json({ entries });
        return;
      }

      const ownerId = segments[0]!;
      const rest = segments.slice(1);
      const full = await listUserEdlDirectory(ownerId, rest);
      const allowed = allowedNamesAt(ownerId, rest, assignments);
      const entries = full.filter((e) => allowed.has(e.name));
      res.json({ entries });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "Liste fehlgeschlagen." });
    }
  });

  r.post("/customer/edl/read-text", bearerAuth, requireCustomerRole, async (req: Request, res: Response) => {
    try {
      const access = await resolveCustomerEdlAccess(req);
      if (!access.ok) {
        respondCustomerEdlForbidden(res, access.mode);
        return;
      }
      const { customerId, assignments } = access;
      const segments = segmentsBody(req.body);
      const fileName = typeof req.body?.fileName === "string" ? req.body.fileName : "";
      if (segments.length < 1 || !fileName) {
        res.status(400).json({ error: "Ungültige Parameter." });
        return;
      }
      const ownerId = segments[0]!;
      const parentSegments = segments.slice(1);
      if (!canReadFile(customerId, ownerId, parentSegments, fileName, assignments)) {
        res.status(403).json({ error: "Kein Zugriff auf diese Datei." });
        return;
      }
      const text = await readUserEdlFileText(ownerId, parentSegments, fileName);
      res.json({ text });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "Lesen fehlgeschlagen." });
    }
  });

  r.post("/customer/edl/read-binary", bearerAuth, requireCustomerRole, async (req: Request, res: Response) => {
    try {
      const access = await resolveCustomerEdlAccess(req);
      if (!access.ok) {
        respondCustomerEdlForbidden(res, access.mode);
        return;
      }
      const { customerId, assignments } = access;
      const segments = segmentsBody(req.body);
      const fileName = typeof req.body?.fileName === "string" ? req.body.fileName : "";
      if (segments.length < 1 || !fileName) {
        res.status(400).json({ error: "Ungültige Parameter." });
        return;
      }
      const ownerId = segments[0]!;
      const parentSegments = segments.slice(1);
      if (!canReadFile(customerId, ownerId, parentSegments, fileName, assignments)) {
        res.status(403).json({ error: "Kein Zugriff auf diese Datei." });
        return;
      }
      const buf = await readUserEdlFileBuffer(ownerId, parentSegments, fileName);
      res.json({ base64: buf.toString("base64") });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "Lesen fehlgeschlagen." });
    }
  });

  r.post("/customer/edl/delete-file", bearerAuth, requireCustomerRole, async (req: Request, res: Response) => {
    try {
      const access = await resolveCustomerEdlAccess(req);
      if (!access.ok) {
        respondCustomerEdlForbidden(res, access.mode);
        return;
      }
      const { customerId, assignments } = access;
      const segments = segmentsBody(req.body);
      const fileName = typeof req.body?.fileName === "string" ? req.body.fileName.trim() : "";
      if (segments.length < 1 || !fileName) {
        res.status(400).json({ error: "Ungültige Parameter." });
        return;
      }
      const ownerId = segments[0]!;
      const parentSegments = segments.slice(1);
      if (!canReadFile(customerId, ownerId, parentSegments, fileName, assignments)) {
        res.status(403).json({ error: "Kein Zugriff auf diese Datei." });
        return;
      }
      await removePlaylistAssignmentForCustomer(customerId, {
        libraryOwnerUserId: ownerId,
        parentSegments,
        fileName,
      });
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "Löschen fehlgeschlagen." });
    }
  });

  return r;
}
