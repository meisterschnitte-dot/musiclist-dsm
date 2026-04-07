import extract from "extract-zip";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { getDataDir } from "./userStore";

/**
 * Verschiebt ein Verzeichnis per rename; scheitert das (Windows/Dropbox/Datei-Locks),
 * als Fallback: rekursiv kopieren und Quelle löschen.
 */
async function moveDataDirectoryAside(src: string, dest: string): Promise<void> {
  try {
    await fs.rename(src, dest);
    return;
  } catch (first: unknown) {
    const code = (first as NodeJS.ErrnoException).code;
    if (
      code !== "EPERM" &&
      code !== "EBUSY" &&
      code !== "EACCES" &&
      code !== "EXDEV"
    ) {
      throw first;
    }
    console.warn(
      `[restore-backup] rename nicht möglich (${code ?? "—"}); Fallback kopieren + löschen (z. B. Dropbox oder geöffnete Dateien).`
    );
    await fs.cp(src, dest, { recursive: true });
    await fs.rm(src, { recursive: true, force: true });
  }
}

/**
 * Entpackt eine mit `streamFullDataBackupZip` erstellte ZIP (oberster Ordner `data/`)
 * und ersetzt das aktuelle Datenverzeichnis. Das bisherige `data/` wird nach
 * `data.pre-restore-<Zeitstempel>` verschoben (falls vorhanden).
 */
export async function restoreDataDirectoryFromBackupZip(zipPath: string): Promise<{
  previousDataRenamedTo: string | null;
}> {
  const extractRoot = path.join(
    path.dirname(zipPath),
    `musiclist-extract-${randomBytes(8).toString("hex")}`
  );
  await fs.mkdir(extractRoot, { recursive: true });
  try {
    await extract(zipPath, { dir: extractRoot });
    const dataExtracted = path.join(extractRoot, "data");
    if (!existsSync(dataExtracted)) {
      throw new Error(
        'Ungültige Sicherung: Im Archiv fehlt der Ordner „data/". Bitte eine Musiclist-Datensicherung verwenden.'
      );
    }

    const dataDir = path.resolve(getDataDir());
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    let backupPath: string | null = null;
    let renamed = false;

    if (existsSync(dataDir)) {
      backupPath = `${dataDir}.pre-restore-${stamp}`;
      let n = 0;
      while (existsSync(backupPath)) {
        n += 1;
        backupPath = `${dataDir}.pre-restore-${stamp}-${n}`;
      }
      await moveDataDirectoryAside(dataDir, backupPath);
      renamed = true;
    }

    try {
      await fs.cp(dataExtracted, dataDir, { recursive: true });
    } catch (e) {
      if (renamed && backupPath && existsSync(backupPath)) {
        try {
          if (existsSync(dataDir)) {
            await fs.rm(dataDir, { recursive: true, force: true });
          }
          await fs.rename(backupPath, dataDir);
        } catch (rollbackErr) {
          console.error("[restore-backup] Rollback fehlgeschlagen:", rollbackErr);
        }
      } else if (!renamed && existsSync(dataDir)) {
        await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
      }
      throw e;
    }

    return { previousDataRenamedTo: backupPath };
  } finally {
    await fs.rm(extractRoot, { recursive: true, force: true }).catch(() => {});
  }
}
