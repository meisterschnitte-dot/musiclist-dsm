import { FormEvent, useEffect, useRef, useState } from "react";
import { browsePlayerFilesystem, type PlayerBrowseEntry } from "../api/playerCatalogApi";

type Props = {
  initialPath: string;
  busy: boolean;
  onClose: () => void;
  onImport: (paths: string[]) => void;
};

export function PlayerImportModal({ initialPath, busy, onClose, onImport }: Props) {
  const [pathDraft, setPathDraft] = useState(initialPath);
  const [parent, setParent] = useState<string | null>(null);
  const [entries, setEntries] = useState<PlayerBrowseEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusPath, setFocusPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const pathInputRef = useRef<HTMLInputElement>(null);
  const focusRowRef = useRef<HTMLDivElement>(null);

  const applyListing = (data: {
    path: string;
    parent: string | null;
    entries: PlayerBrowseEntry[];
    focusPath: string | null;
  }) => {
    setPathDraft(data.path);
    setParent(data.parent);
    setEntries(data.entries);
    setFocusPath(data.focusPath);
    setSelected(data.focusPath ? new Set([data.focusPath]) : new Set());
  };

  const load = async (next: string) => {
    setLoading(true);
    setError(null);
    try {
      applyListing(await browsePlayerFilesystem(next));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ordner nicht geladen.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(initialPath);
  }, [initialPath]);

  useEffect(() => {
    pathInputRef.current?.focus();
    pathInputRef.current?.select();
  }, []);

  useEffect(() => {
    focusRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [focusPath, entries]);

  const toggle = (p: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  const goToDraft = (e?: FormEvent) => {
    e?.preventDefault();
    void load(pathDraft);
  };

  const selectedCount = selected.size;

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="player-import-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="modal modal--new-folder player-import-modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2 id="player-import-title" className="modal-title">
          Zur Musikdatenbank hinzufügen
        </h2>
        <p className="player-workspace__hint">
          Pfad eingeben oder einfügen, dann Ordner bzw. Dateien auswählen. Der Import legt nur neue
          Titel an.
        </p>
        <form className="player-import-modal__addr" onSubmit={goToDraft}>
          <label className="player-import-modal__addr-label" htmlFor="player-import-path">
            Pfad
          </label>
          <input
            id="player-import-path"
            ref={pathInputRef}
            className="player-import-modal__addr-input"
            type="text"
            value={pathDraft}
            spellCheck={false}
            autoComplete="off"
            disabled={busy}
            placeholder="C:\Musik  oder  \\NAS\Share\Titel.mp3"
            onChange={(e) => setPathDraft(e.target.value)}
          />
          <button type="submit" className="btn-cell" disabled={loading || busy}>
            Öffnen
          </button>
        </form>
        <div className="player-import-modal__nav">
          <button
            type="button"
            className="btn-cell"
            disabled={loading || busy || parent === null}
            onClick={() => void load(parent ?? "")}
          >
            Eine Ebene höher
          </button>
          <button type="button" className="btn-cell" disabled={loading || busy} onClick={() => void load("")}>
            Laufwerke
          </button>
        </div>
        {error ? <p className="err">{error}</p> : null}
        <div className="player-import-modal__list" role="list">
          {loading ? (
            <p className="player-workspace__hint">Lade …</p>
          ) : entries.length === 0 ? (
            <p className="player-workspace__hint">Keine Ordner oder Audiodateien.</p>
          ) : (
            entries.map((ent) => (
              <div
                key={ent.path}
                ref={ent.path === focusPath ? focusRowRef : undefined}
                className={[
                  "player-import-modal__row",
                  ent.path === focusPath ? "player-import-modal__row--focus" : "",
                  ent.ingested ? "player-import-modal__row--ingested" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                role="listitem"
              >
                <label className="player-import-modal__check">
                  <input
                    type="checkbox"
                    checked={selected.has(ent.path)}
                    disabled={busy}
                    onChange={() => toggle(ent.path)}
                  />
                  <span>{ent.kind === "dir" ? "Ordner" : "Datei"}</span>
                </label>
                {ent.kind === "dir" ? (
                  <button
                    type="button"
                    className="player-workspace__link"
                    disabled={busy}
                    onClick={() => void load(ent.path)}
                  >
                    {ent.name}
                  </button>
                ) : (
                  <span className="player-import-modal__file">
                    <span className="player-import-modal__name">{ent.name}</span>
                    {ent.ingested ? (
                      <span className="player-import-modal__ingested">bereits vorhanden</span>
                    ) : null}
                  </span>
                )}
              </div>
            ))
          )}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn-modal" disabled={busy} onClick={onClose}>
            Abbrechen
          </button>
          <button
            type="button"
            className="btn-modal primary"
            disabled={busy || selectedCount === 0}
            onClick={() => onImport([...selected])}
          >
            {busy ? "Import läuft…" : `${selectedCount || ""} hinzufügen`.trim()}
          </button>
        </div>
      </div>
    </div>
  );
}
