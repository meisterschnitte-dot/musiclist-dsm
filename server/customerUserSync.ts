import { readCustomersDb, writeCustomersDb, normalizeCustomer } from "./customersFs";
import { normalizeEmail } from "./userStore";

/** Findet einen Kunden nach Name (ohne Groß/Klein) oder legt einen neuen an; trägt die E-Mail ein. */
export async function syncCustomerForInvite(params: {
  companyName: string;
  email: string;
}): Promise<{ customerId: string } | { error: string }> {
  const name = params.companyName.trim();
  if (!name) {
    return { error: "Firmenname fehlt." };
  }
  const email = normalizeEmail(params.email);
  const db = await readCustomersDb();
  const lower = name.toLowerCase();
  const existing = db.customers.find((c) => c.name.trim().toLowerCase() === lower);
  if (existing) {
    const emails = existing.emails.includes(email)
      ? existing.emails
      : [...existing.emails, email].sort((a, b) => a.localeCompare(b));
    const idx = db.customers.findIndex((c) => c.id === existing.id);
    db.customers[idx] = { ...existing, emails };
    await writeCustomersDb(db);
    return { customerId: existing.id };
  }
  const c = normalizeCustomer({ name, emails: [email], groups: [] });
  if (!c || c.emails.length === 0) {
    return { error: "Kunde konnte nicht angelegt werden." };
  }
  db.customers.push(c);
  await writeCustomersDb(db);
  return { customerId: c.id };
}
