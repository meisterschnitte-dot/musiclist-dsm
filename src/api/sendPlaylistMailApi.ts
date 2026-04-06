import { getUsersApiToken } from "./authToken";

const API = "/api";

async function parseError(res: Response): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error || `Anfrage fehlgeschlagen (${res.status}).`;
}

/** Konvertiert einen ArrayBuffer zu Base64 (für Mail-Anhänge). */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

export async function sendPlaylistMailRequest(params: {
  to: string[];
  subject: string;
  text: string;
  /** Optional: HTML-Variante (z. B. Fettschrift); Plaintext bleibt in `text`. */
  html?: string;
  attachmentBase64?: string;
  attachmentFileName?: string;
  /** Nach erfolgreichem Versand: Playlist dem Kunden zuweisen (Kunden-Browser). */
  customerId?: string;
  libraryOwnerUserId?: string;
  parentSegments?: string[];
  playlistFileName?: string;
}): Promise<void> {
  const t = getUsersApiToken();
  if (!t) throw new Error("Nicht angemeldet.");
  const res = await fetch(`${API}/send-mail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      to: params.to,
      subject: params.subject,
      text: params.text,
      ...(params.html?.trim() ? { html: params.html.trim() } : {}),
      attachmentBase64: params.attachmentBase64 ?? "",
      attachmentFileName: params.attachmentFileName ?? "",
      ...(params.customerId?.trim()
        ? {
            customerId: params.customerId.trim(),
            libraryOwnerUserId: params.libraryOwnerUserId ?? "",
            parentSegments: params.parentSegments ?? [],
            playlistFileName: params.playlistFileName ?? "",
          }
        : {}),
    }),
  });
  if (!res.ok) throw new Error(await parseError(res));
}
