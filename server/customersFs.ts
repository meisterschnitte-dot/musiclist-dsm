import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getDataDir } from "./userStore";

const SHARED_DIR = path.join(getDataDir(), "shared");
const CUSTOMERS_FILE = path.join(SHARED_DIR, "customers.json");

export type CustomerEmailGroup = {
  id: string;
  name: string;
  /** Teilmenge der Kunden-E-Mails */
  emails: string[];
};

export type CustomerRecord = {
  id: string;
  name: string;
  emails: string[];
  groups: CustomerEmailGroup[];
};

export type CustomersDb = {
  customers: CustomerRecord[];
};

let chain: Promise<unknown> = Promise.resolve();

async function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn) as Promise<T>;
  chain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function normalizeEmail(e: string): string {
  return e.trim().toLowerCase();
}

function plausibleEmail(s: string): boolean {
  const t = s.trim();
  return t.includes("@") && t.includes(".") && t.length > 5;
}

function normalizeCustomer(c: Partial<CustomerRecord>): CustomerRecord | null {
  const name = typeof c.name === "string" ? c.name.trim() : "";
  if (!name) return null;
  const rawEmails = Array.isArray(c.emails) ? c.emails : [];
  const emails = [...new Set(rawEmails.map((x) => normalizeEmail(String(x))).filter(plausibleEmail))];
  const groupsIn = Array.isArray(c.groups) ? c.groups : [];
  const groups: CustomerEmailGroup[] = [];
  const emailSet = new Set(emails);
  for (const g of groupsIn) {
    const gid = typeof g?.id === "string" && g.id.trim() ? g.id.trim() : randomUUID();
    const gname = typeof g?.name === "string" ? g.name.trim() : "";
    if (!gname) continue;
    const ge = Array.isArray(g?.emails)
      ? [...new Set(g.emails.map((x) => normalizeEmail(String(x))).filter((e) => emailSet.has(e)))]
      : [];
    groups.push({ id: gid, name: gname, emails: ge });
  }
  const id = typeof c.id === "string" && c.id.trim() ? c.id.trim() : randomUUID();
  return { id, name, emails, groups };
}

export function parseCustomersDb(raw: unknown): CustomersDb {
  if (!raw || typeof raw !== "object") return { customers: [] };
  const p = raw as Partial<CustomersDb>;
  const list = Array.isArray(p.customers) ? p.customers : [];
  const customers: CustomerRecord[] = [];
  for (const c of list) {
    const n = normalizeCustomer(c as Partial<CustomerRecord>);
    if (n) customers.push(n);
  }
  return { customers };
}

export async function readCustomersDb(): Promise<CustomersDb> {
  return serialize(async () => {
    try {
      const text = await fs.readFile(CUSTOMERS_FILE, "utf8");
      return parseCustomersDb(JSON.parse(text) as unknown);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return { customers: [] };
      throw e;
    }
  });
}

export async function writeCustomersDb(db: CustomersDb): Promise<void> {
  return serialize(async () => {
    await fs.mkdir(SHARED_DIR, { recursive: true });
    await fs.writeFile(CUSTOMERS_FILE, JSON.stringify(db, null, 2), "utf8");
  });
}

/**
 * Liegt die E-Mail in der Kunden-Hauptliste oder in einer Gruppe (gleiche Normalisierung wie in der Verwaltung).
 * Freigegebene Playlisten nur, wenn diese Prüfung für den eingeloggten Benutzer zutrifft.
 */
export function customerRecordIncludesUserEmail(customer: CustomerRecord, rawEmail: string): boolean {
  const n = normalizeEmail(rawEmail);
  if (!n) return false;
  for (const e of customer.emails) {
    if (normalizeEmail(e) === n) return true;
  }
  for (const g of customer.groups) {
    for (const e of g.emails) {
      if (normalizeEmail(e) === n) return true;
    }
  }
  return false;
}

export async function isUserEmailInCustomerDirectory(
  customerId: string,
  rawEmail: string
): Promise<boolean> {
  const id = customerId.trim();
  if (!id) return false;
  const db = await readCustomersDb();
  const c = db.customers.find((x) => x.id === id);
  if (!c) return false;
  return customerRecordIncludesUserEmail(c, rawEmail);
}

export { normalizeEmail, plausibleEmail, normalizeCustomer };
