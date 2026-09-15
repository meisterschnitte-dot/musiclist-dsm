import { useCallback, useState } from "react";
import {
  bulkPatchMusikverlagDatabaseRows,
  deleteMusikverlagDatabaseRows,
  type MusikverlagBulkPatchDto,
} from "../api/musikverlageApi";
import type { MusikverlagId } from "../musikverlage/musikverlageCatalog";

type Props = {
  open: boolean;
  verlagId: MusikverlagId;
  verlagLabel: string;
  rowKeys: string[];
  onClose: () => void;
  onDone: () => void;
};

type WarnMode = "unchanged" | "on" | "off";

export function MusikverlagBulkEditModal({
  open,
  verlagId,
  verlagLabel,
  rowKeys,
  onClose,
  onDone,
}: Props) {
  const [labelcode, setLabelcode] = useState("");
  const [label, setLabel] = useState("");
  const [hersteller, setHersteller] = useState("");
  const [warnMode, setWarnMode] = useState<WarnMode>("unchanged");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onDelete = useCallback(async () => {
    if (rowKeys.length === 0) return;
    const ok = window.confirm(
      `${rowKeys.length.toLocaleString("de-DE")} Einträge für „${verlagLabel}“ endgültig löschen?\n\n` +
        "Diese Aktion kann nicht rückgängig gemacht werden."
    );
    if (!ok) return;
    setErr(null);
    setBusy(true);
    try {
      await deleteMusikverlagDatabaseRows(verlagId, rowKeys);
      onDone();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Löschen fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }, [onClose, onDone, rowKeys, verlagId, verlagLabel]);

  const onSave = useCallback(async () => {
    if (rowKeys.length === 0) return;
    const patch: MusikverlagBulkPatchDto = {};
    if (labelcode.trim()) patch.labelcode = labelcode.trim();
    if (label.trim()) patch.label = label.trim();
    if (hersteller.trim()) patch.hersteller = hersteller.trim();
    if (warnMode === "on") patch.warnung = true;
    if (warnMode === "off") patch.warnung = false;
    if (Object.keys(patch).length === 0) {
      setErr("Bitte mindestens ein Feld setzen oder Warnung wählen.");
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      await bulkPatchMusikverlagDatabaseRows(verlagId, rowKeys, patch);
      onDone();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Speichern fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }, [hersteller, label, labelcode, onClose, onDone, rowKeys, verlagId, warnMode]);

  if (!open) return null;

  return (
    <div className="modal-backdrop modal-backdrop--stacked" role="presentation" onMouseDown={onClose}>
      <div
        className="modal modal--sys-settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby="musikverlag-bulk-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="musikverlag-bulk-title" className="modal-title">
          Auswahl bearbeiten — {verlagLabel}
        </h2>
        <p className="modal-lead modal-lead--muted">
          {rowKeys.length.toLocaleString("de-DE")} ausgewählte Einträge (aktueller Filter). Leere Felder
          werden beim Speichern nicht überschrieben. Warnung „Unverändert“ lässt die bestehende Einstellung
          pro Zeile.
        </p>
        {err ? (
          <p className="modal-error" role="alert">
            {err}
          </p>
        ) : null}
        <div className="tag-form-grid tag-form-grid--2col">
          <label className="tag-field">
            <span>Labelcode</span>
            <input
              type="text"
              value={labelcode}
              onChange={(e) => setLabelcode(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="tag-field">
            <span>Label</span>
            <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} autoComplete="off" />
          </label>
          <label className="tag-field">
            <span>Hersteller</span>
            <input
              type="text"
              value={hersteller}
              onChange={(e) => setHersteller(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="tag-field">
            <span>Warnung</span>
            <select value={warnMode} onChange={(e) => setWarnMode(e.target.value as WarnMode)}>
              <option value="unchanged">Unverändert</option>
              <option value="on">Warnung setzen</option>
              <option value="off">Warnung entfernen</option>
            </select>
          </label>
        </div>
        <div className="modal-actions modal-actions--spread">
          <button
            type="button"
            className="btn-modal primary btn-modal--danger"
            disabled={busy}
            onClick={() => void onDelete()}
          >
            Auswahl löschen …
          </button>
          <div className="modal-actions">
            <button type="button" className="btn-modal" disabled={busy} onClick={onClose}>
              Abbrechen
            </button>
            <button type="button" className="btn-modal primary" disabled={busy} onClick={() => void onSave()}>
              {busy ? "Speichern …" : "Speichern"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
