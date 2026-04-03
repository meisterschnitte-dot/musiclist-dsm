export type UserRole = "admin" | "user";

/** Vollständiger Datensatz in app-users.json */
export type StoredUser = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: UserRole;
  passwordHash: string;
  salt: string;
  mustChangePassword?: boolean;
  legacyLoginName?: string;
};

export type PublicUser = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: UserRole;
  mustChangePassword?: boolean;
  legacyLoginName?: string;
};

export function toPublicUser(u: StoredUser): PublicUser {
  return {
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    role: u.role,
    mustChangePassword: u.mustChangePassword === true,
    legacyLoginName: u.legacyLoginName,
  };
}
