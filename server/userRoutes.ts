import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { Router } from "express";
import { bearerAuth, requireAdmin } from "./authMiddleware";
import { signUserToken } from "./authToken";
import { INITIAL_INVITE_PASSWORD } from "./constants";
import { generateSalt, hashPassword, verifyPassword } from "./passwordHash";
import {
  countAdmins,
  findByEmail,
  findById,
  findForLogin,
  listUsers,
  makeUser,
  withUserMutation,
} from "./userStore";
import { toPublicUser, type PublicUser, type UserRole, type StoredUser } from "./userTypes";

type BootstrapMutResult =
  | { ok: false; code: number; error: string }
  | { ok: true; token: string; user: PublicUser };
type InviteMutResult = { ok: false; code: number; error: string } | { ok: true; user: PublicUser };
type DeleteMutResult = { ok: false; code: number; error: string } | { ok: true };
type PasswordMutResult = { ok: false; code: number; error: string } | { ok: true; user: PublicUser };

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function plausibleEmail(s: string): boolean {
  const t = s.trim();
  return t.includes("@") && t.includes(".") && t.length > 5;
}

export function createUserApiRouter(): Router {
  const r = Router();

  r.get("/users/hints", (_req, res) => {
    const users = listUsers();
    res.json({
      hints: users.map((u: StoredUser) => ({
        id: u.id,
        email: u.email,
        legacyLoginName: u.legacyLoginName,
      })),
    });
  });

  r.post("/auth/login", (req, res) => {
    const login = typeof req.body?.login === "string" ? req.body.login : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!login.trim() || !password) {
      res.status(400).json({ error: "Anmeldung und Passwort sind erforderlich." });
      return;
    }
    const users = listUsers();
    const u = findForLogin(users, login);
    if (!u || !verifyPassword(u, password)) {
      res.status(401).json({ error: "Unbekannte Anmeldung oder falsches Passwort." });
      return;
    }
    res.json({ token: signUserToken(u.id), user: toPublicUser(u) });
  });

  r.post("/auth/bootstrap", async (req, res) => {
    const firstName = typeof req.body?.firstName === "string" ? req.body.firstName.trim() : "";
    const lastName = typeof req.body?.lastName === "string" ? req.body.lastName.trim() : "";
    const emailRaw = typeof req.body?.email === "string" ? req.body.email : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!firstName || !lastName) {
      res.status(400).json({ error: "Vor- und Nachname sind erforderlich." });
      return;
    }
    if (!plausibleEmail(emailRaw)) {
      res.status(400).json({ error: "Bitte eine gültige E-Mail-Adresse eingeben." });
      return;
    }
    if (password.length < 4) {
      res.status(400).json({ error: "Passwort mindestens 4 Zeichen." });
      return;
    }
    const email = normalizeEmail(emailRaw);
    try {
      const result = await withUserMutation<BootstrapMutResult>((users: StoredUser[]) => {
        if (users.length > 0) {
          return { next: users, result: { ok: false as const, code: 400, error: "Bereits eingerichtet." } };
        }
        if (findByEmail(users, email)) {
          return { next: users, result: { ok: false as const, code: 400, error: "E-Mail bereits vergeben." } };
        }
        const salt = generateSalt();
        const passwordHash = hashPassword(password, salt);
        const id = randomUUID();
        const admin = makeUser({
          id,
          firstName,
          lastName,
          email,
          role: "admin",
          passwordHash,
          salt,
        });
        return {
          next: [admin],
          result: { ok: true as const, token: signUserToken(id), user: toPublicUser(admin) },
        };
      });
      if (!result.ok) {
        res.status(result.code).json({ error: result.error });
        return;
      }
      res.json({ token: result.token, user: result.user });
    } catch (e) {
      console.error("[Musiclist users]", e);
      res.status(500).json({ error: "Einrichtung fehlgeschlagen." });
    }
  });

  r.get("/auth/me", bearerAuth, (req, res) => {
    res.json({ user: toPublicUser(req.authUser!) });
  });

  r.get("/users", bearerAuth, requireAdmin, (_req, res) => {
    res.json({ users: listUsers().map(toPublicUser) });
  });

  r.post("/users/invite", bearerAuth, requireAdmin, async (req, res) => {
    const firstName = typeof req.body?.firstName === "string" ? req.body.firstName.trim() : "";
    const lastName = typeof req.body?.lastName === "string" ? req.body.lastName.trim() : "";
    const emailRaw = typeof req.body?.email === "string" ? req.body.email : "";
    const role = req.body?.role === "admin" ? "admin" : "user";
    if (!firstName || !lastName) {
      res.status(400).json({ error: "Vor- und Nachname sind erforderlich." });
      return;
    }
    if (!plausibleEmail(emailRaw)) {
      res.status(400).json({ error: "Bitte eine gültige E-Mail-Adresse eingeben." });
      return;
    }
    const email = normalizeEmail(emailRaw);
    try {
      const out = await withUserMutation<InviteMutResult>((users: StoredUser[]) => {
        if (findByEmail(users, email)) {
          return { next: users, result: { ok: false as const, code: 400, error: "Diese E-Mail ist bereits registriert." } };
        }
        const salt = generateSalt();
        const passwordHash = hashPassword(INITIAL_INVITE_PASSWORD, salt);
        const id = randomUUID();
        const u = makeUser({
          id,
          firstName,
          lastName,
          email,
          role: role as UserRole,
          passwordHash,
          salt,
          mustChangePassword: true,
        });
        return { next: [...users, u], result: { ok: true as const, user: toPublicUser(u) } };
      });
      if (!out.ok) {
        res.status(out.code).json({ error: out.error });
        return;
      }
      res.json({ user: out.user });
    } catch (e) {
      console.error("[Musiclist users] invite", e);
      res.status(500).json({ error: "Benutzer konnte nicht angelegt werden." });
    }
  });

  r.delete("/users/:id", bearerAuth, requireAdmin, async (req, res) => {
    const id = String(req.params.id);
    const selfId = req.authUser!.id;
    try {
      const out = await withUserMutation<DeleteMutResult>((users: StoredUser[]) => {
        const target = findById(users, id);
        if (!target) {
          return { next: users, result: { ok: false as const, code: 404, error: "Benutzer nicht gefunden." } };
        }
        if (id === selfId) {
          return {
            next: users,
            result: { ok: false as const, code: 400, error: "Eigenes Konto kann nicht gelöscht werden." },
          };
        }
        if (target.role === "admin" && countAdmins(users) <= 1) {
          return {
            next: users,
            result: { ok: false as const, code: 400, error: "Der letzte Administrator kann nicht gelöscht werden." },
          };
        }
        return { next: users.filter((u: StoredUser) => u.id !== id), result: { ok: true as const } };
      });
      if (!out.ok) {
        res.status(out.code).json({ error: out.error });
        return;
      }
      res.json({ ok: true });
    } catch (e) {
      console.error("[Musiclist users] delete", e);
      res.status(500).json({ error: "Löschen fehlgeschlagen." });
    }
  });

  r.patch("/users/:id/password", bearerAuth, async (req, res) => {
    const id = String(req.params.id);
    const au = req.authUser!;
    const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
    if (au.id !== id && au.role !== "admin") {
      res.status(403).json({ error: "Nicht berechtigt." });
      return;
    }
    if (newPassword.length < 6) {
      res.status(400).json({ error: "Neues Passwort mindestens 6 Zeichen." });
      return;
    }
    try {
      const salt = generateSalt();
      const passwordHash = hashPassword(newPassword, salt);
      const out = await withUserMutation<PasswordMutResult>((users: StoredUser[]) => {
        const ix = users.findIndex((u: StoredUser) => u.id === id);
        if (ix < 0) {
          return { next: users, result: { ok: false as const, code: 404, error: "Benutzer nicht gefunden." } };
        }
        const next = [...users];
        next[ix] = {
          ...next[ix],
          salt,
          passwordHash,
          mustChangePassword: false,
        };
        return { next, result: { ok: true as const, user: toPublicUser(next[ix]) } };
      });
      if (!out.ok) {
        res.status(out.code).json({ error: out.error });
        return;
      }
      res.json({ user: out.user });
    } catch (e) {
      console.error("[Musiclist users] password", e);
      res.status(500).json({ error: "Passwort konnte nicht gespeichert werden." });
    }
  });

  return r;
}
