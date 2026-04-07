import { getUsersApiToken } from "./authToken";

function parseContentDispositionFilename(cd: string | null): string {
  if (!cd) return "musiclist-datensicherung.zip";
  const star = /filename\*=UTF-8''([^;\s]+)/i.exec(cd);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      /* fall through */
    }
  }
  const quoted = /filename="([^"]+)"/i.exec(cd);
  if (quoted) return quoted[1];
  return "musiclist-datensicherung.zip";
}

/** Startet den Download einer ZIP mit dem gesamten Server-Datenverzeichnis (JSON-DBs + MP3s). Nur Admin. */
export async function downloadFullDataBackup(): Promise<void> {
  const t = getUsersApiToken();
  if (!t) throw new Error("Nicht angemeldet.");
  const res = await fetch("/api/admin/full-backup", {
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `Sicherung fehlgeschlagen (${res.status}).`);
  }
  const fileName = parseContentDispositionFilename(res.headers.get("Content-Disposition"));
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
