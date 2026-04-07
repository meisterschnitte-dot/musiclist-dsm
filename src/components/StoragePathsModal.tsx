import { useEffect, useState } from "react";
import { apiStoragePathsFetch, type ServerStoragePaths } from "../api/storagePathsApi";
import { copyTextToClipboard } from "../utils/copyToClipboard";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Angemeldet: EDL-/Playlist-Bibliothek liegt auf dem Server. */
  edlLibraryAvailable: boolean;
};

type CopyKey = "data" | "edl" | "mp3";

export function StoragePathsModal({ open, onClose, edlLibraryAvailable }: Props) {
  const [serverPaths, setServerPaths] = useState<ServerStoragePaths | null>(null);
  const [pathsError, setPathsError] = useState<string | null>(null);
  const [pathsLoading, setPathsLoading] = useState(false);
  const [copiedKey, setCopiedKey] = useState<CopyKey | null>(null);

  useEffect(() => {
    if (!open || !edlLibraryAvailable) {
      setServerPaths(null);
      setPathsError(null);
      setPathsLoading(false);
      return;
    }
    setPathsLoading(true);
    setPathsError(null);
    let cancelled = false;
    void apiStoragePathsFetch()
      .then((p) => {
        if (!cancelled) setServerPaths(p);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setServerPaths(null);
          setPathsError(e instanceof Error ? e.message : "Pfade konnten nicht geladen werden.");
        }
      })
      .finally(() => {
        if (!cancelled) setPathsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, edlLibraryAvailable]);

  useEffect(() => {
    if (!copiedKey) return;
    const t = window.setTimeout(() => setCopiedKey(null), 2000);
    return () => clearTimeout(t);
  }, [copiedKey]);

  useEffect(() => {
    if (!open) setCopiedKey(null);
  }, [open]);

  if (!open) return null;

  const handleCopyPath = async (key: CopyKey, text: string | null | undefined) => {
    if (!text?.trim()) return;
    const ok = await copyTextToClipboard(text);
    if (ok) setCopiedKey(key);
  };

  const edlPathDisplay = !edlLibraryAvailable
    ? null
    : pathsLoading
      ? "…"
      : serverPaths
        ? serverPaths.edlLibraryDir
        : pathsError;

  const mp3PathDisplay = !edlLibraryAvailable
    ? null
    : pathsLoading
      ? "…"
      : serverPaths
        ? serverPaths.tracksDir
        : pathsError;

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="storage-paths-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal modal--storage-paths" onMouseDown={(e) => e.stopPropagation()}>
        <h2 id="storage-paths-title" className="modal-title">
          Speicherpfade
        </h2>
        <p className="modal-lead">
          EDL-/Playlist-Bibliothek und Fake-MP3-Musikdatenbank werden auf dem Server gespeichert. Es ist
          kein Ordner auf Ihrem Rechner mehr nötig.
        </p>

        {edlLibraryAvailable && serverPaths && (
          <div
            className="storage-paths-data-root"
            aria-label="Gemeinsames Datenverzeichnis auf dem Server"
          >
            <p className="storage-paths-current storage-paths-path-label-only">
              <span className="storage-paths-current-label">Datenverzeichnis (Server):</span>
            </p>
            <div className="storage-paths-path-row">
              <div className="storage-paths-server-path mono-cell storage-paths-path-row__path">
                {serverPaths.dataDir}
              </div>
              <button
                type="button"
                className="btn-storage-path-copy"
                aria-label="Datenverzeichnis-Pfad in die Zwischenablage kopieren"
                onClick={() => void handleCopyPath("data", serverPaths.dataDir)}
              >
                {copiedKey === "data" ? "Kopiert" : "Pfad kopieren"}
              </button>
            </div>
          </div>
        )}

        <section className="storage-paths-section" aria-labelledby="storage-paths-edl-label">
          <h3 id="storage-paths-edl-label" className="storage-paths-heading">
            EDL- & Playlist Browser
          </h3>
          <p className="storage-paths-hint">
            Nach dem Anmelden erscheint die Bibliothek automatisch in der linken Spalte.
          </p>
          {!edlLibraryAvailable ? (
            <p className="storage-paths-current">
              <span className="storage-paths-current-label">Aktuell:</span>{" "}
              <span className="storage-paths-current-value mono-cell">— nach Anmeldung verfügbar —</span>
            </p>
          ) : (
            <>
              <p className="storage-paths-current">
                <span className="storage-paths-current-label">Ordner auf dem Server (Ihr Konto):</span>
              </p>
              <div className="storage-paths-path-row">
                <div
                  className="storage-paths-server-path mono-cell storage-paths-path-row__path"
                  role="region"
                  aria-label="Pfad EDL-Bibliothek"
                >
                  {edlPathDisplay}
                </div>
                {serverPaths?.edlLibraryDir && (
                  <button
                    type="button"
                    className="btn-storage-path-copy"
                    aria-label="EDL-Bibliothek-Pfad in die Zwischenablage kopieren"
                    onClick={() => void handleCopyPath("edl", serverPaths.edlLibraryDir)}
                  >
                    {copiedKey === "edl" ? "Kopiert" : "Pfad kopieren"}
                  </button>
                )}
              </div>
            </>
          )}
        </section>

        <section className="storage-paths-section" aria-labelledby="storage-paths-tracks-label">
          <h3 id="storage-paths-tracks-label" className="storage-paths-heading">
            Musikdatenbank (Fake-MP3)
          </h3>
          <p className="storage-paths-hint">
            Alle Nutzer teilen dieselben Dateien. Nur Administratoren dürfen MP3-Dateien vom Server
            löschen; alle angemeldeten Nutzer dürfen Dateien anlegen und ID3-Tags bearbeiten.
          </p>
          {!edlLibraryAvailable ? (
            <p className="storage-paths-current">
              <span className="storage-paths-current-label">Aktuell:</span>{" "}
              <span className="storage-paths-current-value">
                Fake-MP3s liegen installationsweit auf dem API-Server unter „data/shared/tracks/“ relativ
                zum Datenverzeichnis — nach Anmeldung siehst du den absoluten Pfad.
              </span>
            </p>
          ) : (
            <>
              <p className="storage-paths-current">
                <span className="storage-paths-current-label">Ordner auf dem Server:</span>
              </p>
              <div className="storage-paths-path-row">
                <div
                  className="storage-paths-server-path mono-cell storage-paths-path-row__path"
                  role="region"
                  aria-label="Pfad gemeinsame MP3-Ablage"
                >
                  {mp3PathDisplay}
                </div>
                {serverPaths?.tracksDir && (
                  <button
                    type="button"
                    className="btn-storage-path-copy"
                    aria-label="Musikdatenbank-Pfad in die Zwischenablage kopieren"
                    onClick={() => void handleCopyPath("mp3", serverPaths.tracksDir)}
                  >
                    {copiedKey === "mp3" ? "Kopiert" : "Pfad kopieren"}
                  </button>
                )}
              </div>
            </>
          )}
        </section>

        <div className="modal-actions">
          <button type="button" className="btn-modal" onClick={onClose}>
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}
