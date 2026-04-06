import type { EdlDirEntry } from "../edl/edlLibraryFs";
import { getUsersApiToken } from "./authToken";

const API = "/api";

async function parseError(res: Response): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error || `Anfrage fehlgeschlagen (${res.status}).`;
}

function authHeaders(): HeadersInit {
  const t = getUsersApiToken();
  if (!t) throw new Error("Nicht angemeldet.");
  return { Authorization: `Bearer ${t}`, "Content-Type": "application/json" };
}

export async function apiCustomerEdlList(segments: string[]): Promise<EdlDirEntry[]> {
  const res = await fetch(`${API}/customer/edl/list`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ segments }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { entries?: EdlDirEntry[] };
  return Array.isArray(data.entries) ? data.entries : [];
}

export async function apiCustomerEdlReadText(segments: string[], fileName: string): Promise<string> {
  const res = await fetch(`${API}/customer/edl/read-text`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ segments, fileName }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { text?: string };
  return typeof data.text === "string" ? data.text : "";
}

export async function apiCustomerEdlReadBinary(segments: string[], fileName: string): Promise<ArrayBuffer> {
  const res = await fetch(`${API}/customer/edl/read-binary`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ segments, fileName }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { base64?: string };
  const b64 = typeof data.base64 === "string" ? data.base64 : "";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export async function apiCustomerEdlDeleteFile(segments: string[], fileName: string): Promise<void> {
  const res = await fetch(`${API}/customer/edl/delete-file`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ segments, fileName }),
  });
  if (!res.ok) throw new Error(await parseError(res));
}
