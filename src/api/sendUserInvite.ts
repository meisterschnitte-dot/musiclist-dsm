import { getUsersApiToken } from "./authToken";

export type SendUserInvitePayload = {
  email: string;
  firstName: string;
  lastName: string;
  roleLabel: string;
  appUrl: string;
};

export async function sendUserInvite(payload: SendUserInvitePayload): Promise<void> {
  const token = getUsersApiToken();
  if (!token) {
    throw new Error("Nicht angemeldet — Begrüßungsmail nur für angemeldete Administratoren.");
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  const res = await fetch("/api/send-user-invite", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `E-Mail-Versand fehlgeschlagen (${res.status}).`);
  }
}
