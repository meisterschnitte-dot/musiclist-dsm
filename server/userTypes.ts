export type UserRole = "admin" | "user" | "customer";

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
  /** Optional: Anzeigename der Firma (Kundenrolle); Verknüpfung zu Kundenverwaltung. */
  companyName?: string;
  /** Verweis auf Eintrag in `customers.json` — alle Logins dieses Kunden teilen dieselben Playlists. */
  customerId?: string;
};

export type PublicUser = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: UserRole;
  mustChangePassword?: boolean;
  legacyLoginName?: string;
  companyName?: string;
  customerId?: string;
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
    companyName: u.companyName,
    customerId: u.customerId,
  };
}
