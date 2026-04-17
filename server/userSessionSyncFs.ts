import { existsSync, mkdirSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { getDataDir } from "./userStore";

const DIR_NAME = "user-sessions";
const MAX_BYTES = 20 * 1024 * 1024;

export type StoredUserSessionFile = {
  v: 1;
  updatedAt: string;
  workspace: unknown;
  tagStore: unknown;
  /** Heartbeats je Browser-Tab/-Fenster (sessionStorage-ID). */
  clients?: Record<string, string>;
};

export type UserSessionPresence = {
  loggedIn: boolean;
  doubleLogin: boolean;
  activeClientCount: number;
  lastSeenAtIso: string | null;
};

function sessionPath(userId: string): string {
  return path.join(getDataDir(), DIR_NAME, `${userId}.json`);
}

export async function readUserSessionFile(userId: string): Promise<StoredUserSessionFile | null> {
  const p = sessionPath(userId);
  if (!existsSync(p)) return null;
  try {
    const raw = await fs.readFile(p, "utf8");
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== "object") return null;
    const o = data as Record<string, unknown>;
    if (o.v !== 1 || typeof o.updatedAt !== "string") return null;
    let clients: Record<string, string> | undefined;
    if (o.clients && typeof o.clients === "object" && !Array.isArray(o.clients)) {
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(o.clients as Record<string, unknown>)) {
        if (!k.trim() || typeof v !== "string") continue;
        if (Number.isNaN(new Date(v).getTime())) continue;
        next[k] = v;
      }
      clients = Object.keys(next).length ? next : undefined;
    }
    return {
      v: 1,
      updatedAt: o.updatedAt,
      workspace: o.workspace ?? null,
      tagStore: o.tagStore ?? null,
      clients,
    };
  } catch {
    return null;
  }
}

function pruneStaleClients(
  clients: Record<string, string> | undefined,
  nowMs: number,
  maxIdleMs: number
): Record<string, string> {
  if (!clients) return {};
  const out: Record<string, string> = {};
  for (const [clientId, ts] of Object.entries(clients)) {
    const t = new Date(ts).getTime();
    if (!Number.isFinite(t)) continue;
    if (nowMs - t > maxIdleMs) continue;
    out[clientId] = ts;
  }
  return out;
}

export async function writeUserSessionFile(
  userId: string,
  payload: { workspace: unknown; tagStore: unknown; clientId?: string }
): Promise<StoredUserSessionFile> {
  const dir = path.join(getDataDir(), DIR_NAME);
  mkdirSync(dir, { recursive: true });
  const nowMs = Date.now();
  const updatedAt = new Date(nowMs).toISOString();
  const existing = await readUserSessionFile(userId);
  const clients = pruneStaleClients(existing?.clients, nowMs, 10 * 60 * 1000);
  const cid = (payload.clientId ?? "").trim();
  if (cid) clients[cid] = updatedAt;
  const out: StoredUserSessionFile = {
    v: 1,
    updatedAt,
    workspace: payload.workspace ?? null,
    tagStore: payload.tagStore ?? null,
    ...(Object.keys(clients).length ? { clients } : {}),
  };
  const buf = Buffer.from(JSON.stringify(out), "utf8");
  if (buf.length > MAX_BYTES) {
    throw new Error("Sitzungsdaten zu groß (max. ca. 20 MB).");
  }
  const finalPath = sessionPath(userId);
  const tmp = `${finalPath}.${process.pid}.tmp`;
  await fs.writeFile(tmp, buf);
  await fs.rename(tmp, finalPath);
  return out;
}

export async function readUserSessionPresenceMap(
  nowMs: number = Date.now(),
  activeWithinMs: number = 3 * 60 * 1000
): Promise<Record<string, UserSessionPresence>> {
  const dir = path.join(getDataDir(), DIR_NAME);
  try {
    const ents = await fs.readdir(dir, { withFileTypes: true });
    const out: Record<string, UserSessionPresence> = {};
    for (const e of ents) {
      if (!e.isFile() || !e.name.endsWith(".json")) continue;
      const userId = e.name.slice(0, -5);
      if (!userId) continue;
      const data = await readUserSessionFile(userId);
      if (!data) continue;
      const activeClients = pruneStaleClients(data.clients, nowMs, activeWithinMs);
      const lastSeenAtIso = data.updatedAt;
      const lastSeenMs = new Date(lastSeenAtIso).getTime();
      const loggedIn = Number.isFinite(lastSeenMs) && nowMs - lastSeenMs <= activeWithinMs;
      const activeClientCount = Object.keys(activeClients).length;
      out[userId] = {
        loggedIn,
        doubleLogin: activeClientCount > 1,
        activeClientCount,
        lastSeenAtIso,
      };
    }
    return out;
  } catch {
    return {};
  }
}
