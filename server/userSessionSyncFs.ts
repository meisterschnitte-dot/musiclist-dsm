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
    return {
      v: 1,
      updatedAt: o.updatedAt,
      workspace: o.workspace ?? null,
      tagStore: o.tagStore ?? null,
    };
  } catch {
    return null;
  }
}

export async function writeUserSessionFile(
  userId: string,
  payload: { workspace: unknown; tagStore: unknown }
): Promise<StoredUserSessionFile> {
  const dir = path.join(getDataDir(), DIR_NAME);
  mkdirSync(dir, { recursive: true });
  const updatedAt = new Date().toISOString();
  const out: StoredUserSessionFile = {
    v: 1,
    updatedAt,
    workspace: payload.workspace ?? null,
    tagStore: payload.tagStore ?? null,
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
