import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";

const BCRYPT_ROUNDS = 10;

export function hashPassword(password: string, _salt?: string): string {
  return bcrypt.hashSync(password, BCRYPT_ROUNDS);
}

export function generateSalt(): string {
  return randomBytes(16).toString("hex");
}

export function verifyPassword(user: { passwordHash: string; salt: string }, password: string): boolean {
  // Support legacy SHA-256 hashes (64 hex chars) for existing users
  if (user.passwordHash.length === 64 && /^[0-9a-f]{64}$/.test(user.passwordHash)) {
    const legacy = createHash("sha256").update(`${user.salt}:${password}`, "utf8").digest("hex");
    return legacy === user.passwordHash;
  }
  return bcrypt.compareSync(password, user.passwordHash);
}
