export type SendUserInvitePayload = {
  email: string;
  firstName: string;
  lastName: string;
  roleLabel: string;
  appUrl: string;
};

export async function sendUserInvite(payload: SendUserInvitePayload): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const secret =
    import.meta.env.VITE_MUSICLIST_MAIL_SECRET?.trim() ||
    import.meta.env.VITE_EASY_GEMA_MAIL_SECRET?.trim();
  if (secret) headers["X-Musiclist-Mail-Secret"] = secret;

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
