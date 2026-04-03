import { createHash, randomBytes } from "node:crypto";

/** Gleicher Algorithmus wie im Browser (appUsersStorage). */
export function hashPassword(password: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${password}`, "utf8").digest("hex");
}

export function generateSalt(): string {
  return randomBytes(16).toString("hex");
}

export function verifyPassword(user: { passwordHash: string; salt: string }, password: string): boolean {
  return hashPassword(password, user.salt) === user.passwordHash;
}
