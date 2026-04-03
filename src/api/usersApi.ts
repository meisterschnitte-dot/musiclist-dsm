import type { AppUserRecord, UserRole } from "../storage/appUsersStorage";
import { getUsersApiToken } from "./authToken";

const API = "/api";

async function parseError(res: Response): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error || `Anfrage fehlgeschlagen (${res.status}).`;
}

export type LoginHint = { id: string; email: string; legacyLoginName?: string };

export async function fetchUserHints(): Promise<LoginHint[]> {
  const res = await fetch(`${API}/users/hints`);
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { hints?: LoginHint[] };
  return Array.isArray(data.hints) ? data.hints : [];
}

export async function loginRequest(login: string, password: string): Promise<{ token: string; user: AppUserRecord }> {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login, password }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<{ token: string; user: AppUserRecord }>;
}

export async function bootstrapAdminRequest(body: {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}): Promise<{ token: string; user: AppUserRecord }> {
  const res = await fetch(`${API}/auth/bootstrap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<{ token: string; user: AppUserRecord }>;
}

export async function fetchUsersList(): Promise<AppUserRecord[]> {
  const t = getUsersApiToken();
  if (!t) throw new Error("Nicht angemeldet.");
  const res = await fetch(`${API}/users`, { headers: { Authorization: `Bearer ${t}` } });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { users?: AppUserRecord[] };
  return Array.isArray(data.users) ? data.users : [];
}

export async function inviteUserRequest(body: {
  firstName: string;
  lastName: string;
  email: string;
  role: UserRole;
}): Promise<AppUserRecord> {
  const t = getUsersApiToken();
  if (!t) throw new Error("Nicht angemeldet.");
  const res = await fetch(`${API}/users/invite`, {
    method: "POST",
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { user: AppUserRecord };
  return data.user;
}

export async function deleteUserRequest(userId: string): Promise<void> {
  const t = getUsersApiToken();
  if (!t) throw new Error("Nicht angemeldet.");
  const res = await fetch(`${API}/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) throw new Error(await parseError(res));
}

export async function changePasswordRequest(userId: string, newPassword: string): Promise<AppUserRecord> {
  const t = getUsersApiToken();
  if (!t) throw new Error("Nicht angemeldet.");
  const res = await fetch(`${API}/users/${encodeURIComponent(userId)}/password`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    body: JSON.stringify({ newPassword }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { user: AppUserRecord };
  return data.user;
}
