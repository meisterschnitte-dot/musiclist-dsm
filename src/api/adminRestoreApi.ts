import { getUsersApiToken } from "./authToken";

export type RestoreBackupResult = {
  ok: boolean;
  previousDataRenamedTo: string | null;
};

/** Lädt eine ZIP-Datensicherung hoch und ersetzt auf dem Server das Verzeichnis `data/`. Nur Admin. */
export async function uploadRestoreBackup(file: File): Promise<RestoreBackupResult> {
  const t = getUsersApiToken();
  if (!t) throw new Error("Nicht angemeldet.");
  const fd = new FormData();
  fd.append("backup", file, file.name);
  const res = await fetch("/api/admin/restore-backup", {
    method: "POST",
    headers: { Authorization: `Bearer ${t}` },
    body: fd,
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean; previousDataRenamedTo?: string | null };
  if (!res.ok) {
    throw new Error(data.error || `Wiederherstellung fehlgeschlagen (${res.status}).`);
  }
  return {
    ok: data.ok === true,
    previousDataRenamedTo: data.previousDataRenamedTo ?? null,
  };
}
