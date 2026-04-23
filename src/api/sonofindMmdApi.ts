import { getUsersApiToken } from "./authToken";

const API = "/api";

function authHeaders(): HeadersInit {
  const t = getUsersApiToken();
  if (!t) throw new Error("Nicht angemeldet.");
  return { Authorization: `Bearer ${t}`, Accept: "application/xml" };
}

/**
 * SonoFind-Öffentliches MMD-XML (serverseitiger Proxy, CORS-frei).
 * @see https://www.sonofind.com/mmd/ — [musicmetadata.org](https://musicmetadata.org)
 */
export async function apiSonofindMmdFetch(trackcode: string): Promise<string> {
  const tc = trackcode.trim();
  if (!tc) throw new Error("Kein Trackcode.");
  const res = await fetch(
    `${API}/sonofind/mmd?${new URLSearchParams({ trackcode: tc }).toString()}`,
    { headers: authHeaders() }
  );
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 400);
    try {
      const j = JSON.parse(text) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* */
    }
    throw new Error(msg || `SonoFind MMD (${res.status}).`);
  }
  return text;
}
