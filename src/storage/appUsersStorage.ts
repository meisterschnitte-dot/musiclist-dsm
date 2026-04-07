export type UserRole = "admin" | "user" | "customer";

/** Öffentliche Nutzerdaten (Passwort-Hash nur auf dem Server). */
export type AppUserRecord = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: UserRole;
  mustChangePassword?: boolean;
  legacyLoginName?: string;
  companyName?: string;
  customerId?: string;
  /** Fehlt: gilt als aktiv. */
  active?: boolean;
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function displayName(u: AppUserRecord): string {
  const fn = u.firstName.trim();
  const ln = u.lastName.trim();
  const combined = `${fn} ${ln}`.trim();
  if (combined) return combined;
  const leg = u.legacyLoginName?.trim();
  if (leg) return leg;
  return u.email;
}

export function normalizeUserEmail(email: string): string {
  return normalizeEmail(email);
}

export function findUserByEmail(users: AppUserRecord[], email: string): AppUserRecord | undefined {
  const e = normalizeEmail(email);
  return users.find((u) => u.email === e);
}

export function findUserForLogin(users: AppUserRecord[], login: string): AppUserRecord | undefined {
  const t = login.trim().toLowerCase();
  if (!t) return undefined;
  const byEmail = users.find((u) => u.email === t);
  if (byEmail) return byEmail;
  return users.find((u) => u.legacyLoginName?.trim().toLowerCase() === t);
}

export function countAdmins(users: AppUserRecord[]): number {
  return users.filter((u) => u.role === "admin").length;
}

export function isUserRecordActive(u: AppUserRecord): boolean {
  return u.active !== false;
}

export function countActiveAdmins(users: AppUserRecord[]): number {
  return users.filter((u) => u.role === "admin" && isUserRecordActive(u)).length;
}
