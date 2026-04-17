import { getUsersApiToken } from "./authToken";
import type { PersistedWorkspaceV1 } from "../storage/workspaceStorage";
import type { TagStore } from "../storage/audioTagsStorage";

const API = "/api";

async function parseError(res: Response): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error || `Anfrage fehlgeschlagen (${res.status}).`;
}

function authHeaders(): HeadersInit {
  const t = getUsersApiToken();
  if (!t) throw new Error("Nicht angemeldet.");
  return { Authorization: `Bearer ${t}` };
}

export type UserSessionSyncPayload = {
  updatedAt: string | null;
  workspace: unknown;
  tagStore: unknown;
};

export type UserSessionSyncConflictPayload = {
  updatedAt: string;
  workspace: unknown;
  tagStore: unknown;
};

export type UserSessionSyncPutResult =
  | { ok: true; updatedAt: string }
  | { ok: false; conflict: UserSessionSyncConflictPayload };

/** Liest den gespeicherten Arbeitsbereich und Tag-Store vom Server (gleicher Login auf allen Geräten). */
export async function apiUserSessionSyncFetch(): Promise<UserSessionSyncPayload> {
  const res = await fetch(`${API}/me/session-sync`, {
    method: "GET",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as UserSessionSyncPayload;
  return {
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : null,
    workspace: data.workspace,
    tagStore: data.tagStore,
  };
}

/**
 * Speichert Arbeitsbereich + Tags. `baseUpdatedAt`: zuletzt bekannter Server-Zeitstempel (`null` = noch keine Server-Datei);
 * bei Abweichung 409 mit Konflikt-Payload (sofern `force` nicht gesetzt).
 */
export async function apiUserSessionSyncPut(payload: {
  workspace: PersistedWorkspaceV1 | null;
  tagStore: TagStore;
  /** Weglassen = altes Verhalten ohne Konfliktprüfung (nur für Kompatibilität). */
  baseUpdatedAt?: string | null;
  force?: boolean;
  /** Pro Browser-Tab/-Fenster stabil; dient der Doppel-Login-Erkennung. */
  clientId?: string;
}): Promise<UserSessionSyncPutResult> {
  const body: Record<string, unknown> = {
    workspace: payload.workspace,
    tagStore: payload.tagStore,
  };
  if (payload.baseUpdatedAt !== undefined) {
    body.baseUpdatedAt = payload.baseUpdatedAt;
  }
  if (payload.force) {
    body.force = true;
  }
  if (payload.clientId?.trim()) {
    body.clientId = payload.clientId.trim();
  }
  const res = await fetch(`${API}/me/session-sync`, {
    method: "PUT",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (res.status === 409) {
    const data = (await res.json().catch(() => ({}))) as {
      conflict?: boolean;
      updatedAt?: unknown;
      workspace?: unknown;
      tagStore?: unknown;
    };
    if (
      data.conflict &&
      typeof data.updatedAt === "string" &&
      (data.workspace !== undefined || data.tagStore !== undefined)
    ) {
      return {
        ok: false,
        conflict: {
          updatedAt: data.updatedAt,
          workspace: data.workspace ?? null,
          tagStore: data.tagStore ?? null,
        },
      };
    }
    throw new Error(await parseError(res));
  }
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { updatedAt?: unknown };
  const u = data.updatedAt;
  if (typeof u !== "string") {
    throw new Error("Ungültige Server-Antwort.");
  }
  return { ok: true, updatedAt: u };
}
