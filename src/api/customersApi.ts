import { getUsersApiToken } from "./authToken";

const API = "/api";

async function parseError(res: Response): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error || `Anfrage fehlgeschlagen (${res.status}).`;
}

export type CustomerEmailGroup = {
  id: string;
  name: string;
  emails: string[];
};

export type CustomerRecord = {
  id: string;
  name: string;
  emails: string[];
  groups: CustomerEmailGroup[];
};

export async function fetchCustomersList(): Promise<CustomerRecord[]> {
  const t = getUsersApiToken();
  if (!t) throw new Error("Nicht angemeldet.");
  const res = await fetch(`${API}/customers`, { headers: { Authorization: `Bearer ${t}` } });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { customers?: CustomerRecord[] };
  return Array.isArray(data.customers) ? data.customers : [];
}

export async function createCustomerRequest(body: {
  name: string;
  emails: string[];
  groups: CustomerEmailGroup[];
}): Promise<CustomerRecord> {
  const t = getUsersApiToken();
  if (!t) throw new Error("Nicht angemeldet.");
  const res = await fetch(`${API}/customers`, {
    method: "POST",
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { customer: CustomerRecord };
  return data.customer;
}

export async function updateCustomerRequest(customer: CustomerRecord): Promise<CustomerRecord> {
  const t = getUsersApiToken();
  if (!t) throw new Error("Nicht angemeldet.");
  const res = await fetch(`${API}/customers/${encodeURIComponent(customer.id)}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
    body: JSON.stringify(customer),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { customer: CustomerRecord };
  return data.customer;
}

export async function deleteCustomerRequest(id: string): Promise<void> {
  const t = getUsersApiToken();
  if (!t) throw new Error("Nicht angemeldet.");
  const res = await fetch(`${API}/customers/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) throw new Error(await parseError(res));
}
