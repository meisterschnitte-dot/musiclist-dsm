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
  /** Verweis auf `customers.json` — freigegebene Playlisten nur, wenn `email` noch in der Kundenliste steht. */
  customerId?: string;
  /** Fehlt in älteren JSON-Dateien: gilt als aktiv. */
  active?: boolean;
  /** Zugriff auf den Musiclist-Bereich. Fehlt: erlaubt. */
  musiclistAccess?: boolean;
  /** Zugriff auf den Musicplayer (gesamte Player-Musikdatenbank). Fehlt: nur Administratoren. */
  playerAccess?: boolean;
};

export function hasMusiclistAccess(u: Pick<StoredUser, "role" | "musiclistAccess">): boolean {
  return u.role === "admin" || u.musiclistAccess !== false;
}

export function hasPlayerAccess(u: Pick<StoredUser, "role" | "playerAccess">): boolean {
  return u.role === "admin" || u.playerAccess === true;
}

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
  active: boolean;
  musiclistAccess: boolean;
  playerAccess: boolean;
};

export function toPublicUser(u: StoredUser): PublicUser {
  const active = u.active !== false;
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
    active,
    musiclistAccess: hasMusiclistAccess(u),
    playerAccess: hasPlayerAccess(u),
  };
}
