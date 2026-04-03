type Props = {
  open: boolean;
  onClose: () => void;
  /** Angemeldet: EDL-/Playlist-Bibliothek liegt auf dem Server. */
  edlLibraryAvailable: boolean;
};

export function StoragePathsModal({ open, onClose, edlLibraryAvailable }: Props) {
  if (!open) return null;

  const edlLine = edlLibraryAvailable
    ? "Persönliche Bibliothek auf dem Server (automatisch, kein Ordner nötig)"
    : "— nach Anmeldung verfügbar —";

  const mp3Line =
    "Fake-MP3s liegen installationsweit auf dem API-Server unter „data/shared/tracks/“ — kein lokaler Ordner.";

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

        <section className="storage-paths-section" aria-labelledby="storage-paths-edl-label">
          <h3 id="storage-paths-edl-label" className="storage-paths-heading">
            EDL- & Playlist Browser
          </h3>
          <p className="storage-paths-hint">
            Nach dem Anmelden erscheint die Bibliothek automatisch in der linken Spalte.
          </p>
          <p className="storage-paths-current">
            <span className="storage-paths-current-label">Aktuell:</span>{" "}
            <span className="storage-paths-current-value mono-cell">{edlLine}</span>
          </p>
        </section>

        <section className="storage-paths-section" aria-labelledby="storage-paths-tracks-label">
          <h3 id="storage-paths-tracks-label" className="storage-paths-heading">
            Musikdatenbank (Fake-MP3)
          </h3>
          <p className="storage-paths-hint">
            Alle Nutzer teilen dieselben Dateien. Nur Administratoren dürfen MP3-Dateien vom Server
            löschen; alle angemeldeten Nutzer dürfen Dateien anlegen und ID3-Tags bearbeiten.
          </p>
          <p className="storage-paths-current">
            <span className="storage-paths-current-label">Aktuell:</span>{" "}
            <span className="storage-paths-current-value mono-cell">{mp3Line}</span>
          </p>
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
