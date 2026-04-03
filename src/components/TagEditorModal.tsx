import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { AUDIO_TAG_FIELD_LABELS, type AudioTags } from "../audio/audioTags";
import type { GvlLabelEntry } from "../storage/gvlLabelStore";
import { parseGemaOcrText } from "../audio/parseGemaOcrText";
import {
  openP7S1MusikportalWithOptionalClip,
  P7S1_MUSIKPORTAL_TRACK_RESEARCH_URL,
} from "../p7s1Musikportal";

type TagFormFields = Record<Exclude<keyof AudioTags, "warnung">, string>;

function formFromMerged(t: AudioTags): TagFormFields {
  return {
    songTitle: t.songTitle ?? "",
    artist: t.artist ?? "",
    album: t.album ?? "",
    year: t.year ?? "",
    comment: t.comment ?? "",
    composer: t.composer ?? "",
    labelcode: t.labelcode ?? "",
    label: t.label ?? "",
    hersteller: t.hersteller ?? "",
    gvlRechte: t.gvlRechte ?? "",
  };
}

function formToAudioTags(f: TagFormFields, warnung: boolean): AudioTags {
  return { ...f, warnung };
}

/** Nur Auswahl innerhalb des Dateinamen-Blocks (nicht z. B. in Eingabefeldern). */
function getTrimmedFilenameSelection(root: HTMLElement | null): string | null {
  if (!root) return null;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const t = sel.toString().trim();
  if (!t) return null;
  const a = sel.anchorNode;
  const f = sel.focusNode;
  if (!a || !f) return null;
  if (!root.contains(a) || !root.contains(f)) return null;
  return t;
}

const FILENAME_TARGET_FIELDS = [
  { key: "songTitle" as const, label: "Songtitel", shortcut: "S" },
  { key: "artist" as const, label: "Interpret", shortcut: "I" },
  { key: "album" as const, label: "Albumtitel", shortcut: "A" },
  { key: "composer" as const, label: "Komponist", shortcut: "K" },
];

const FILENAME_KEY_TO_FIELD: Record<string, (typeof FILENAME_TARGET_FIELDS)[number]["key"]> = {
  s: "songTitle",
  i: "artist",
  a: "album",
  k: "composer",
};

export type GvlApplyFromDbPayload = { id: number; entry: GvlLabelEntry };

type Props = {
  open: boolean;
  heading: string;
  initial: AudioTags;
  /** Dateiname oder Titel für P7S1-Zwischenablage (Suchpräfix bis zum ersten _). */
  p7SearchSource?: string | null;
  /** Zeile aus GVL-Tabelle → Tag-Felder überschreiben (id wechselt pro Klick). */
  gvlApplyFromDb?: GvlApplyFromDbPayload | null;
  /** Nur Administratoren: GVL-Datenbank unter „Verwaltung“. */
  showGvlDatabaseButton?: boolean;
  onOpenGvlDatabase: () => void;
  onClose: () => void;
  onSave: (tags: AudioTags) => void | Promise<void>;
};

export function TagEditorModal({
  open,
  heading,
  initial,
  p7SearchSource = null,
  gvlApplyFromDb = null,
  showGvlDatabaseButton = true,
  onOpenGvlDatabase,
  onClose,
  onSave,
}: Props) {
  const [form, setForm] = useState(() => formFromMerged(initial));
  const [warnToggle, setWarnToggle] = useState(() => initial.warnung === true);
  const [saveBusy, setSaveBusy] = useState(false);
  const saveMountedRef = useRef(true);
  const [pasteDraft, setPasteDraft] = useState("");
  const [overwriteParsed, setOverwriteParsed] = useState(true);
  const filenameSelectRef = useRef<HTMLDivElement>(null);
  const [filenameCtx, setFilenameCtx] = useState<
    null | { x: number; y: number; selectionText: string }
  >(null);

  const applyFilenameSelectionToField = useCallback(
    (field: (typeof FILENAME_TARGET_FIELDS)[number]["key"], text: string) => {
      const v = text.trim();
      if (!v) return;
      setForm((prev) => ({ ...prev, [field]: v }));
      setFilenameCtx(null);
    },
    []
  );

  useEffect(() => {
    saveMountedRef.current = true;
    return () => {
      saveMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setForm(formFromMerged(initial));
    setWarnToggle(initial.warnung === true);
    setSaveBusy(false);
    setPasteDraft("");
    setOverwriteParsed(true);
  }, [open, initial]);

  useEffect(() => {
    if (!open || !gvlApplyFromDb) return;
    const { entry } = gvlApplyFromDb;
    setForm((prev) => ({
      ...prev,
      labelcode: entry.labelcode,
      label: entry.label,
      hersteller: entry.hersteller,
      gvlRechte: entry.rechterueckrufe,
    }));
  }, [open, gvlApplyFromDb?.id]);

  useEffect(() => {
    if (!open || !p7SearchSource?.trim()) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const field = FILENAME_KEY_TO_FIELD[e.key.toLowerCase()];
      if (!field) return;
      const ae = document.activeElement;
      if (ae instanceof HTMLInputElement || ae instanceof HTMLTextAreaElement) return;
      const text = getTrimmedFilenameSelection(filenameSelectRef.current);
      if (!text) return;
      e.preventDefault();
      applyFilenameSelectionToField(field, text);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, p7SearchSource, applyFilenameSelectionToField]);

  useEffect(() => {
    if (!filenameCtx) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (t instanceof Element && t.closest(".tag-filename-ctx-menu")) return;
      setFilenameCtx(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFilenameCtx(null);
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [filenameCtx]);

  const onFilenameContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!p7SearchSource?.trim()) return;
    const text = getTrimmedFilenameSelection(filenameSelectRef.current);
    if (!text) return;
    e.preventDefault();
    const pad = 6;
    const mw = 260;
    const mh = 220;
    let x = e.clientX;
    let y = e.clientY;
    if (x + mw + pad > window.innerWidth) x = Math.max(pad, window.innerWidth - mw - pad);
    if (y + mh + pad > window.innerHeight) y = Math.max(pad, window.innerHeight - mh - pad);
    setFilenameCtx({ x, y, selectionText: text });
  };

  const applyPastedOcr = () => {
    const { fields, extraCommentLines } = parseGemaOcrText(pasteDraft);
    const extraBlock = extraCommentLines.join("\n").trim();
    setForm((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(fields) as (keyof TagFormFields)[]) {
        const v = fields[k];
        if (typeof v !== "string" || !v.trim()) continue;
        const cur = (next[k] ?? "").trim();
        if (overwriteParsed || !cur) {
          (next as Record<string, string>)[k] = v.trim();
        }
      }
      if (extraBlock) {
        if (overwriteParsed) {
          next.comment = extraBlock;
        } else {
          const c = (next.comment ?? "").trim();
          next.comment = c ? `${c}\n${extraBlock}` : extraBlock;
        }
      }
      return next;
    });
  };

  if (!open) return null;

  const set =
    (key: keyof TagFormFields) =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setForm((prev) => ({ ...prev, [key]: e.target.value }));
    };

  return (
    <div
      className="modal-backdrop modal-backdrop--tag-editor"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tag-modal-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal modal--tag" onMouseDown={(e) => e.stopPropagation()}>
        <h2 id="tag-modal-title" className="modal-title">
          {heading}
        </h2>
        {p7SearchSource?.trim() ? (
          <div className="tag-filename-wrap">
            <p className="tag-filename-hint">
              Dateiname: markieren, dann Rechtsklick oder Tasten{" "}
              <kbd className="tag-filename-kbd">S</kbd> Songtitel, <kbd className="tag-filename-kbd">I</kbd>{" "}
              Interpret, <kbd className="tag-filename-kbd">A</kbd> Album, <kbd className="tag-filename-kbd">K</kbd>{" "}
              Komponist
            </p>
            <div
              ref={filenameSelectRef}
              className="tag-filename-selectable mono-cell"
              onContextMenu={onFilenameContextMenu}
              title="Text mit der Maus markieren"
            >
              {p7SearchSource.trim()}
            </div>
          </div>
        ) : null}
        <div className="tag-import-block">
          <div className="tag-import-heading">Text aus GEMA / Google Lens</div>
          <p className="tag-import-hint">
            OCR-Text einfügen (TITEL, CD, JAHR, …). Bei LABEL/VERLAG: Text vor dem ersten{" "}
            <code>/</code> → Label, alles danach → Hersteller (Verlag); ein{" "}
            <code>(LC …)</code> direkt hinter dem Verlag wird entfernt.
          </p>
          <textarea
            className="tag-import-textarea"
            value={pasteDraft}
            onChange={(e) => setPasteDraft(e.target.value)}
            placeholder={"TITEL …\nCD …\nJAHR …"}
            rows={5}
            spellCheck={false}
            aria-label="Eingefügter GEMA- oder Lens-Text"
          />
          <label className="tag-import-overwrite">
            <input
              type="checkbox"
              checked={overwriteParsed}
              onChange={(e) => setOverwriteParsed(e.target.checked)}
            />
            <span>Erkannte Felder überschreiben (sonst nur leere füllen; Kommentar wird angehängt)</span>
          </label>
          <button type="button" className="btn-modal tag-import-btn" onClick={applyPastedOcr}>
            Felder übernehmen
          </button>
        </div>
        <div className="tag-form">
          <label className="tag-field">
            <span>Songtitel</span>
            <input type="text" value={form.songTitle} onChange={set("songTitle")} autoComplete="off" />
          </label>
          <label className="tag-field">
            <span>Interpret</span>
            <input type="text" value={form.artist} onChange={set("artist")} autoComplete="off" />
          </label>
          <label className="tag-field">
            <span>Albumtitel</span>
            <input type="text" value={form.album} onChange={set("album")} autoComplete="off" />
          </label>
          <label className="tag-field">
            <span>Jahr</span>
            <input type="text" value={form.year} onChange={set("year")} autoComplete="off" />
          </label>
          <label className="tag-field">
            <span>Komponist</span>
            <input type="text" value={form.composer} onChange={set("composer")} autoComplete="off" />
          </label>
          <div className="tag-field-row tag-field-row--comment-warn">
            <label className="tag-field">
              <span>Kommentar</span>
              <textarea value={form.comment} onChange={set("comment")} rows={2} />
            </label>
            <label className="tag-field tag-field--warnung-inline">
              <span>Warnung</span>
              <input
                type="checkbox"
                className="tag-warn-switch"
                checked={warnToggle}
                onChange={(e) => setWarnToggle(e.target.checked)}
              />
            </label>
          </div>
          <label className="tag-field">
            <span>Labelcode</span>
            <input type="text" value={form.labelcode} onChange={set("labelcode")} autoComplete="off" />
          </label>
          <label className="tag-field">
            <span>Label</span>
            <input type="text" value={form.label} onChange={set("label")} autoComplete="off" />
          </label>
          <label className="tag-field">
            <span>Hersteller</span>
            <input type="text" value={form.hersteller} onChange={set("hersteller")} autoComplete="off" />
          </label>
          <label className="tag-field">
            <span>{AUDIO_TAG_FIELD_LABELS.gvlRechte}</span>
            <input type="text" value={form.gvlRechte} onChange={set("gvlRechte")} autoComplete="off" />
          </label>
        </div>
        <div className="modal-actions modal-actions--tag">
          <div className="modal-actions--tag-left">
            <button
              type="button"
              className="btn-modal"
              title={`${P7S1_MUSIKPORTAL_TRACK_RESEARCH_URL} — kopiert zugleich den Suchbegriff (Dateiname bis zum ersten _) in die Zwischenablage.`}
              onClick={() => openP7S1MusikportalWithOptionalClip(p7SearchSource)}
            >
              P7S1_Musikportal
            </button>
            {showGvlDatabaseButton ? (
              <button
                type="button"
                className="btn-modal"
                title="GVL-Labeldatenbank öffnen: filtern und Zeile mit „Übernehmen“ ins Tag-Fenster zurückschreiben."
                onClick={onOpenGvlDatabase}
              >
                GVL-Rechte
              </button>
            ) : null}
          </div>
          <div className="modal-actions--tag-right">
            <button type="button" className="btn-modal" onClick={onClose}>
              Abbrechen
            </button>
            <button
              type="button"
              className="btn-modal primary"
              disabled={saveBusy}
              onClick={() => {
                if (saveBusy) return;
                setSaveBusy(true);
                void Promise.resolve(onSave(formToAudioTags(form, warnToggle))).finally(() => {
                  if (saveMountedRef.current) setSaveBusy(false);
                });
              }}
            >
              {saveBusy ? "Speichern …" : "Speichern"}
            </button>
          </div>
        </div>
      </div>
      {filenameCtx ? (
        <>
          <div
            className="tags-ctx-backdrop tag-filename-ctx-backdrop"
            aria-hidden
            onMouseDown={() => setFilenameCtx(null)}
          />
          <div
            className="tags-ctx-menu tag-filename-ctx-menu"
            role="menu"
            aria-label="Markierung übernehmen"
            style={{ left: filenameCtx.x, top: filenameCtx.y }}
          >
            {FILENAME_TARGET_FIELDS.map(({ key, label, shortcut }) => (
              <button
                key={key}
                type="button"
                role="menuitem"
                className="tags-ctx-menu-item"
                onClick={() => applyFilenameSelectionToField(key, filenameCtx.selectionText)}
              >
                {label}{" "}
                <span className="tag-filename-ctx-shortcut">({shortcut})</span>
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
