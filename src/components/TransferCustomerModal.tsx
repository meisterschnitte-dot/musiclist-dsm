import { useCallback, useEffect, useState } from "react";
import { fetchCustomersList, type CustomerRecord } from "../api/customersApi";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Nach OK: gewählte Kunden-ID (nicht leer). */
  onConfirm: (customerId: string) => void;
  title?: string;
  intro?: string;
};

export function TransferCustomerModal({
  open,
  onClose,
  onConfirm,
  title = "Kunde für Playlist & Mail",
  intro = "Die erzeugte .list wird diesem Kunden zugeordnet. Er sieht sie im Konto erst nach dem Versand der Playlist-Mail. Ohne Auswahl kein Transfer.",
}: Props) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [customerId, setCustomerId] = useState("");

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setCustomerId("");
    setBusy(true);
    void fetchCustomersList()
      .then((rows) => setCustomers(rows))
      .catch((e) => setErr(e instanceof Error ? e.message : "Kunden konnten nicht geladen werden."))
      .finally(() => setBusy(false));
  }, [open]);

  const submit = useCallback(() => {
    const id = customerId.trim();
    if (!id) {
      setErr("Bitte einen Kunden auswählen.");
      return;
    }
    onConfirm(id);
  }, [customerId, onConfirm]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="transfer-customer-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal modal--transfer-customer" onMouseDown={(e) => e.stopPropagation()}>
        <h2 id="transfer-customer-title" className="modal-title">
          {title}
        </h2>
        <p className="modal-lead">{intro}</p>
        {err && <p className="user-auth-err">{err}</p>}
        <label className="tag-field playlist-mail-field">
          <span>Kunde</span>
          <select
            className="playlist-mail-select"
            value={customerId}
            onChange={(e) => {
              setCustomerId(e.target.value);
              setErr(null);
            }}
            disabled={busy}
            aria-required="true"
          >
            <option value="">— Kunde wählen —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <div className="modal-actions">
          <button type="button" className="btn-modal primary" disabled={busy} onClick={submit}>
            OK — Transfer starten
          </button>
          <button type="button" className="btn-modal" disabled={busy} onClick={onClose}>
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  );
}
