import type { NextFunction, Request, Response } from "express";
import { verifyUserToken } from "./authToken";
import { findById, listUsers } from "./userStore";
export function bearerAuth(req: Request, res: Response, next: NextFunction): void {
  const h = req.headers.authorization;
  const m = typeof h === "string" ? h.match(/^Bearer\s+(.+)$/i) : null;
  if (!m?.[1]) {
    res.status(401).json({ error: "Nicht angemeldet." });
    return;
  }
  const v = verifyUserToken(m[1]);
  if (!v) {
    res.status(401).json({ error: "Sitzung ungültig oder abgelaufen." });
    return;
  }
  const u = findById(listUsers(), v.userId);
  if (!u) {
    res.status(401).json({ error: "Benutzer nicht gefunden." });
    return;
  }
  req.authUser = u;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.authUser?.role !== "admin") {
    res.status(403).json({ error: "Nur für Administratoren." });
    return;
  }
  next();
}

export function requireCustomerRole(req: Request, res: Response, next: NextFunction): void {
  if (req.authUser?.role !== "customer") {
    res.status(403).json({ error: "Nur für Kundenkonten." });
    return;
  }
  next();
}

export type { StoredUser } from "./userTypes";
