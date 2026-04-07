import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import archiver from "archiver";
import type { Response } from "express";
import { getDataDir } from "./userStore";

/**
 * Streamt eine ZIP-Datei mit dem gesamten Datenverzeichnis (`data/`):
 * app-users.json, shared (JSON-DBs, MP3s unter tracks), users/.../edl …
 */
export function streamFullDataBackupZip(res: Response): void {
  const dataRoot = path.resolve(getDataDir());
  if (!existsSync(dataRoot)) {
    res.status(500).json({ error: "Datenverzeichnis wurde nicht gefunden." });
    return;
  }
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  const fileName = `musiclist-datensicherung-${stamp}.zip`;
  const safeAsciiName = fileName.replace(/[^\w.-]/g, "_");

  const archive = archiver("zip", { zlib: { level: 6 } });

  archive.on("error", (err: Error) => {
    console.error("[full-backup]", err);
    if (!res.writableEnded) {
      res.destroy();
    }
  });

  res.setHeader("Content-Type", "application/zip");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${safeAsciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
  );

  archive.pipe(res);

  void (async () => {
    try {
      await appendDataTreeToArchive(archive, dataRoot, "data");
      await archive.finalize();
    } catch (e) {
      console.error("[full-backup]", e);
      try {
        archive.abort();
      } catch {
        /* ignore */
      }
      if (!res.headersSent) {
        res.status(500).json({ error: "Sicherung konnte nicht erstellt werden." });
      } else if (!res.writableEnded) {
        res.destroy();
      }
    }
  })();
}

async function appendDataTreeToArchive(
  archive: archiver.Archiver,
  absDir: string,
  zipRelativePrefix: string
): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return;
    throw e;
  }
  for (const ent of entries) {
    const abs = path.join(absDir, ent.name);
    const inZip = `${zipRelativePrefix}/${ent.name}`.replace(/\\/g, "/");
    if (ent.isDirectory()) {
      await appendDataTreeToArchive(archive, abs, inZip);
    } else if (ent.isFile()) {
      archive.file(abs, { name: inZip });
    }
  }
}
