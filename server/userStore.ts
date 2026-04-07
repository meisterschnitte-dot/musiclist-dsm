import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { StoredUser, UserRole } from "./userTypes";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR =
  process.env.MUSICLIST_DATA_DIR?.trim() ||
  process.env.EASY_GEMA_DATA_DIR?.trim() ||
  path.join(__dirname, "..", "data");
const USERS_FILE = path.join(DATA_DIR, "app-users.json");

/** Projekt-`data/`-Pfad (Benutzer-JSON, `users/<id>/edl/`, …). */
export function getDataDir(): string {
  return DATA_DIR;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

let writeChain: Promise<unknown> = Promise.resolve();

function readUsersSync(): StoredUser[] {
  if (!existsSync(USERS_FILE)) return [];
  try {
    const raw = readFileSync(USERS_FILE, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: StoredUser[] = [];
    for (const row of parsed) {
      if (!row || typeof row !== "object") continue;
      const o = row as Record<string, unknown>;
      const roleRaw = o.role;
      const role: UserRole =
        roleRaw === "admin" || roleRaw === "user" || roleRaw === "customer" ? roleRaw : "user";
      if (
        typeof o.id === "string" &&
        typeof o.firstName === "string" &&
        typeof o.lastName === "string" &&
        typeof o.email === "string" &&
        typeof o.passwordHash === "string" &&
        typeof o.salt === "string"
      ) {
        out.push({
          id: o.id,
          firstName: o.firstName,
          lastName: o.lastName,
          email: normalizeEmail(o.email),
          role,
          passwordHash: o.passwordHash,
          salt: o.salt,
          mustChangePassword: o.mustChangePassword === true,
          legacyLoginName: typeof o.legacyLoginName === "string" ? o.legacyLoginName : undefined,
          companyName: typeof o.companyName === "string" && o.companyName.trim() ? o.companyName.trim() : undefined,
          customerId: typeof o.customerId === "string" && o.customerId.trim() ? o.customerId.trim() : undefined,
          active: o.active === false ? false : true,
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

function writeUsersSync(users: StoredUser[]): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf8");
}

export async function withUserMutation<T>(fn: (users: StoredUser[]) => { next: StoredUser[]; result: T }): Promise<T> {
  const run: Promise<T> = writeChain.then(() => {
    const current = readUsersSync();
    const { next, result } = fn([...current]);
    writeUsersSync(next);
    return result;
  });
  writeChain = run.then(
    () => {},
    () => {}
  );
  return run;
}

export function listUsers(): StoredUser[] {
  return readUsersSync();
}

export function findById(users: StoredUser[], id: string): StoredUser | undefined {
  return users.find((u) => u.id === id);
}

export function findForLogin(users: StoredUser[], login: string): StoredUser | undefined {
  const t = login.trim().toLowerCase();
  if (!t) return undefined;
  const byEmail = users.find((u) => u.email === t);
  if (byEmail) return byEmail;
  return users.find((u) => u.legacyLoginName?.trim().toLowerCase() === t);
}

export function findByEmail(users: StoredUser[], email: string): StoredUser | undefined {
  const e = normalizeEmail(email);
  return users.find((u) => u.email === e);
}

export function countAdmins(users: StoredUser[]): number {
  return users.filter((u) => u.role === "admin").length;
}

export function makeUser(partial: {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: UserRole;
  passwordHash: string;
  salt: string;
  mustChangePassword?: boolean;
  legacyLoginName?: string;
  companyName?: string;
  customerId?: string;
  active?: boolean;
}): StoredUser {
  return {
    id: partial.id,
    firstName: partial.firstName.trim(),
    lastName: partial.lastName.trim(),
    email: normalizeEmail(partial.email),
    role: partial.role,
    passwordHash: partial.passwordHash,
    salt: partial.salt,
    mustChangePassword: partial.mustChangePassword,
    legacyLoginName: partial.legacyLoginName,
    companyName: partial.companyName?.trim() || undefined,
    customerId: partial.customerId?.trim() || undefined,
    active: partial.active === false ? false : true,
  };
}

export function isUserActive(u: StoredUser): boolean {
  return u.active !== false;
}

/** Administratoren, die sich anmelden dürfen (aktiv). */
export function countActiveAdmins(users: StoredUser[]): number {
  return users.filter((u) => u.role === "admin" && isUserActive(u)).length;
}
