import { getDirectoryAndFileNameForTracksPath } from "./tracks/tracksFolderPaths";

/**
 * Ordner der MP3 sichtbar machen: Web-Apps können keinen Windows-Explorer mit /select öffnen.
 * Statt „Teilen“ (navigator.share) öffnen wir die native Dateiauswahl mit startIn = Speicherordner —
 * dort sieht man dieselben Dateien wie im Explorer. Fallback: Hinweis in die Zwischenablage.
 */
export async function tryRevealMp3InTracksFolder(
  tracksDir: FileSystemDirectoryHandle,
  relativePath: string
): Promise<
  { ok: true; mode: "picker" } | { ok: true; mode: "clipboard" } | { ok: false; message: string }
> {
  let containingDir: FileSystemDirectoryHandle;
  let baseName: string;
  try {
    const r = await getDirectoryAndFileNameForTracksPath(tracksDir, relativePath);
    containingDir = r.dir;
    baseName = r.fileName;
    await containingDir.getFileHandle(baseName, { create: false });
  } catch {
    return {
      ok: false,
      message: `Die Datei „${relativePath}“ wurde im gewählten Speicherort nicht gefunden.`,
    };
  }

  const pick = typeof window.showOpenFilePicker === "function" ? window.showOpenFilePicker : null;
  if (pick) {
    try {
      await pick.call(window, {
        startIn: containingDir,
        multiple: false,
        types: [{ description: "MP3", accept: { "audio/mpeg": [".mp3"] } }],
      });
      return { ok: true, mode: "picker" };
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        return { ok: true, mode: "picker" };
      }
      /* z. B. nicht unterstützt → Zwischenablage */
    }
  }

  try {
    const hint = `Speicherort (Ordnername): „${tracksDir.name}“\nRelativer Pfad: „${relativePath.replace(/\\/g, "/")}“\n\nÖffnen Sie diesen Ordner im Windows-Explorer (derselbe Ordner wie unter „Verwaltung“ › Speicherort). Ein direktes Öffnen des Explorers liefert der Browser nicht.`;
    await navigator.clipboard.writeText(hint);
    return { ok: true, mode: "clipboard" };
  } catch {
    return {
      ok: false,
      message: `Bitte den Speicherort unter „Verwaltung“ im Explorer öffnen und „${relativePath.replace(/\\/g, "/")}“ auswählen.`,
    };
  }
}
