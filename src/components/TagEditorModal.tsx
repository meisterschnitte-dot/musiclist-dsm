import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type ChangeEvent,
  type FocusEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  AUDIO_TAG_FIELD_LABELS,
  rechterueckrufImpliesWarnung,
  warnungEffective,
  type AudioTags,
} from "../audio/audioTags";
import {
  findGvlEntryByLabelcode,
  loadGvlLabelDb,
  type GvlLabelDb,
  type GvlLabelEntry,
} from "../storage/gvlLabelStore";
import { parseGemaOcrText } from "../audio/parseGemaOcrText";
import { openAppleMusicWithOptionalClip, APPLE_MUSIC_SEARCH_URL } from "../appleMusicSearch";
import {
  openP7S1MusikportalWithOptionalClip,
  P7S1_MUSIKPORTAL_TRACK_RESEARCH_URL,
} from "../p7s1Musikportal";
import {
  openBmgPmSearchWithOptionalClipAsync,
  BMGPM_SEARCH_URL,
} from "../bmgProductionMusic";
import { openUpmSearchWithOptionalClipAsync, UPM_SEARCH_URL } from "../upmUniversalProductionMusic";
import { openSonotonSearchWithOptionalClip, SONOTON_SEARCH_BASE_URL } from "../sonotonSearch";
import { openEarmotionSearchWithOptionalClip, EARMOTION_ACCOUNT_URL } from "../earmotionSearch";
import {
  openExtremeMusicSearchWithOptionalClip,
  EXTREME_MUSIC_URL,
} from "../extremeMusicSearch";
import {
  apiBlankframeTracksFetch,
  mapBlankframeTrackToAudioTagsPartial,
} from "../api/blankframeApi";
import {
  extractBlankframeCatalogIds,
  labelcodeWithLcPrefix,
  openBlankframeSearchWithOptionalClip,
} from "../blankframeSearch";
import {
  looksLikeBmgPmMetadata,
  parseBmgPmMetadataText,
} from "../audio/parseBmgPmMetadataText";
import {
  looksLikeSonotonMetadata,
  parseSonotonMetadataText,
} from "../audio/parseSonotonMetadataText";
import {
  looksLikeEarmotionMetadata,
  parseEarmotionMetadataText,
} from "../audio/parseEarmotionMetadataText";
import {
  looksLikeAppleMusicCreditsText,
  parseAppleMusicCreditsText,
} from "../audio/parseAppleMusicCreditsText";
import {
  looksLikeBlankframeMetadata,
  parseBlankframeMetadataText,
} from "../audio/parseBlankframeMetadataText";
import {
  looksLikeExtremeMusicMetadata,
  parseExtremeMusicMetadataText,
} from "../audio/parseExtremeMusicMetadataText";
import { lookupWcpmTags } from "../api/musikverlageApi";

type TagFormFields = Record<Exclude<keyof AudioTags, "warnung">, string>;

function formFromMerged(t: AudioTags): TagFormFields {
  return {
    songTitle: t.songTitle ?? "",
    artist: t.artist ?? "",
    album: t.album ?? "",
    year: t.year ?? "",
    comment: t.comment ?? "",
    composer: t.composer ?? "",
    isrc: t.isrc ?? "",
    labelcode: t.labelcode ?? "",
    label: t.label ?? "",
    hersteller: t.hersteller ?? "",
    gvlRechte: t.gvlRechte ?? "",
  };
}

function formToAudioTags(f: TagFormFields, warnToggle: boolean): AudioTags {
  const r3 = rechterueckrufImpliesWarnung(f.gvlRechte);
  const manualOnly = warnToggle && !r3;
  return { ...f, warnung: manualOnly ? true : false };
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

type OnSaveTag = (
  tags: AudioTags,
  meta?: { multi: true; touchedKeys: readonly string[] }
) => void | Promise<void>;

type Props = {
  open: boolean;
  heading: string;
  initial: AudioTags;
  /** Mehrere Titel: leere Felder, nur ausgefüllte (und bei Labelcode ggf. GVL-Bundle) werden gesetzt. */
  multiTrack?: boolean;
  /** Dateiname oder Titel für P7S1-Zwischenablage (Suchpräfix bis zum ersten _). */
  p7SearchSource?: string | null;
  /** Zeile aus GVL-Tabelle → Tag-Felder überschreiben (id wechselt pro Klick). */
  gvlApplyFromDb?: GvlApplyFromDbPayload | null;
  /**
   * Aktuelle GVL-Liste (wie in den Systemeinstellungen); für OCR-Import per Labelcode.
   * Wenn nicht gesetzt, wird nur localStorage gelesen (kann hinter IndexedDB zurückliegen).
   */
  gvlLabelDb?: GvlLabelDb | null;
  /** Nur Administratoren: GVL-Datenbank unter „Verwaltung“. */
  showGvlDatabaseButton?: boolean;
  onOpenGvlDatabase: () => void;
  onClose: () => void;
  onSave: OnSaveTag;
};

export function TagEditorModal({
  open,
  heading,
  initial,
  multiTrack = false,
  p7SearchSource = null,
  gvlApplyFromDb = null,
  gvlLabelDb = null,
  showGvlDatabaseButton = true,
  onOpenGvlDatabase,
  onClose,
  onSave,
}: Props) {
  const [form, setForm] = useState(() => formFromMerged(initial));
  const [warnToggle, setWarnToggle] = useState(() => warnungEffective(initial));
  /** Nur bei multiTrack: welche Felder der Nutzer gesetzt hat (inkl. „warnung“). */
  const [multiTouched, setMultiTouched] = useState<Set<string>>(() => new Set());
  const [saveBusy, setSaveBusy] = useState(false);
  const saveMountedRef = useRef(true);
  const [pasteDraft, setPasteDraft] = useState("");
  const [overwriteParsed, setOverwriteParsed] = useState(true);
  const prevR3InRechteRef = useRef(false);
  const filenameSelectRef = useRef<HTMLDivElement>(null);
  const [filenameCtx, setFilenameCtx] = useState<
    null | { x: number; y: number; selectionText: string }
  >(null);
  const [blankframeApiBusy, setBlankframeApiBusy] = useState(false);
  const [blankframeApiErr, setBlankframeApiErr] = useState<string | null>(null);
  const [wcpmApiBusy, setWcpmApiBusy] = useState(false);
  const [wcpmApiErr, setWcpmApiErr] = useState<string | null>(null);
  const [labelcodeLookupHint, setLabelcodeLookupHint] = useState<string | null>(null);

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
    if (multiTrack) {
      setForm(formFromMerged({}));
      setWarnToggle(false);
      setMultiTouched(new Set());
    } else {
      setForm(formFromMerged(initial));
      setWarnToggle(warnungEffective(initial));
    }
    prevR3InRechteRef.current = multiTrack ? false : rechterueckrufImpliesWarnung(initial.gvlRechte);
    setSaveBusy(false);
    setPasteDraft("");
    setOverwriteParsed(true);
    setBlankframeApiErr(null);
    setWcpmApiErr(null);
    setLabelcodeLookupHint(null);
  }, [open, initial, multiTrack]);

  useEffect(() => {
    if (!open || !gvlApplyFromDb || multiTrack) return;
    const { entry } = gvlApplyFromDb;
    setForm((prev) => ({
      ...prev,
      labelcode: labelcodeWithLcPrefix(entry.labelcode),
      label: entry.label,
      hersteller: entry.hersteller,
      gvlRechte: entry.rechterueckrufe,
    }));
  }, [open, gvlApplyFromDb?.id]);

  useEffect(() => {
    if (!open) return;
    const now = rechterueckrufImpliesWarnung(form.gvlRechte);
    if (now) setWarnToggle(true);
    else if (prevR3InRechteRef.current && !now) setWarnToggle(false);
    prevR3InRechteRef.current = now;
  }, [open, form.gvlRechte]);

  useEffect(() => {
    if (!open || !p7SearchSource?.trim() || multiTrack) return;
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
  }, [open, p7SearchSource, applyFilenameSelectionToField, multiTrack]);

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
    const { fields, extraCommentLines } = looksLikeBmgPmMetadata(pasteDraft)
      ? parseBmgPmMetadataText(pasteDraft)
      : looksLikeAppleMusicCreditsText(pasteDraft)
        ? parseAppleMusicCreditsText(pasteDraft)
        : looksLikeSonotonMetadata(pasteDraft)
          ? parseSonotonMetadataText(pasteDraft)
          : looksLikeExtremeMusicMetadata(pasteDraft)
            ? parseExtremeMusicMetadataText(pasteDraft)
            : looksLikeEarmotionMetadata(pasteDraft)
              ? parseEarmotionMetadataText(pasteDraft)
              : looksLikeBlankframeMetadata(pasteDraft)
                ? parseBlankframeMetadataText(pasteDraft)
                : parseGemaOcrText(pasteDraft);
    let mergedFields: Partial<AudioTags> = { ...fields };
    const lc = mergedFields.labelcode?.trim();
    if (lc) {
      const db = gvlLabelDb ?? loadGvlLabelDb();
      const entry = findGvlEntryByLabelcode(db, lc);
      if (entry) {
        mergedFields = {
          ...mergedFields,
          label: entry.label,
          hersteller: entry.hersteller,
          gvlRechte: entry.rechterueckrufe,
        };
      }
    }
    const extraBlock = extraCommentLines.join("\n").trim();
    setForm((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(mergedFields) as (keyof TagFormFields)[]) {
        const v = mergedFields[k];
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

  const onBlankframeSearchClick = useCallback(async () => {
    setBlankframeApiErr(null);
    const src = p7SearchSource?.trim();
    const ids = extractBlankframeCatalogIds(src);
    if (ids.length === 0) {
      openBlankframeSearchWithOptionalClip(p7SearchSource);
      return;
    }
    setBlankframeApiBusy(true);
    try {
      const tracks = await apiBlankframeTracksFetch(ids.join(","));
      if (tracks.length === 0) {
        setBlankframeApiErr("Blankframe lieferte keine Tracks.");
        return;
      }
      const want = ids[0]!;
      const track =
        tracks.find((t) => (t.catalogTrackNumber ?? "").toLowerCase() === want.toLowerCase()) ??
        tracks[0]!;
      const partial = mapBlankframeTrackToAudioTagsPartial(track);
      setForm((prev) => {
        const next = { ...prev };
        for (const k of Object.keys(partial) as (keyof typeof partial)[]) {
          if (k === "warnung") continue;
          const v = partial[k as keyof typeof partial];
          if (typeof v !== "string" || !v.trim()) continue;
          (next as Record<string, string>)[k] = v.trim();
        }
        const lc = next.labelcode?.trim();
        if (lc) {
          const db = gvlLabelDb ?? loadGvlLabelDb();
          const entry = findGvlEntryByLabelcode(db, lc);
          if (entry) {
            next.label = entry.label;
            next.hersteller = entry.hersteller;
            next.gvlRechte = entry.rechterueckrufe;
          }
        }
        return next;
      });
    } catch (e) {
      setBlankframeApiErr(e instanceof Error ? e.message : "Blankframe-API fehlgeschlagen.");
    } finally {
      setBlankframeApiBusy(false);
    }
  }, [p7SearchSource, gvlLabelDb]);

  const onWcpmLookupClick = useCallback(async () => {
    setWcpmApiErr(null);
    const src = p7SearchSource?.trim();
    if (!src) return;
    setWcpmApiBusy(true);
    try {
      const partial = await lookupWcpmTags(src);
      setForm((prev) => {
        const next = { ...prev };
        const keys: (keyof TagFormFields)[] = [
          "songTitle",
          "artist",
          "album",
          "composer",
          "isrc",
          "labelcode",
        ];
        for (const k of keys) {
          const v = partial[k as keyof typeof partial];
          if (typeof v !== "string" || !v.trim()) continue;
          (next as Record<string, string>)[k] = v.trim();
        }
        const lc = next.labelcode?.trim();
        if (lc) {
          const db = gvlLabelDb ?? loadGvlLabelDb();
          const entry = findGvlEntryByLabelcode(db, lc);
          if (entry) {
            next.label = entry.label;
            next.hersteller = entry.hersteller;
            next.gvlRechte = entry.rechterueckrufe;
          } else {
            next.label = "";
            next.hersteller = "";
            next.gvlRechte = "";
          }
        } else {
          next.label = "";
          next.hersteller = "";
          next.gvlRechte = "";
        }
        return next;
      });
      if (partial.warnung === true) {
        setWarnToggle(true);
      } else {
        const db = gvlLabelDb ?? loadGvlLabelDb();
        const lc = partial.labelcode?.trim() ?? "";
        if (lc && !findGvlEntryByLabelcode(db, lc)) {
          setWarnToggle(true);
        } else if (lc) {
          setWarnToggle(false);
        }
      }
    } catch (e) {
      setWcpmApiErr(e instanceof Error ? e.message : "WCPM-Lookup fehlgeschlagen.");
    } finally {
      setWcpmApiBusy(false);
    }
  }, [p7SearchSource, gvlLabelDb]);

  const setStandard = useCallback(
    (key: keyof TagFormFields) =>
      (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setForm((prev) => ({ ...prev, [key]: e.target.value }));
      },
    []
  );

  const setMultiField = useCallback(
    (key: keyof TagFormFields) =>
      (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setMultiTouched((prev) => new Set(prev).add(key));
        setForm((prev) => ({ ...prev, [key]: e.target.value }));
      },
    []
  );

  const applyLabelcodeWithGvlLookup = useCallback(
    (raw: string, markTouched: boolean) => {
      const normalized = labelcodeWithLcPrefix(raw);
      const lc = normalized.trim();
      const db = gvlLabelDb ?? loadGvlLabelDb();
      const entry = lc ? findGvlEntryByLabelcode(db, lc) : undefined;
      setForm((prev) => ({
        ...prev,
        labelcode: normalized,
        ...(entry
          ? {
              label: entry.label,
              hersteller: entry.hersteller,
              gvlRechte: entry.rechterueckrufe,
            }
          : {}),
      }));
      setLabelcodeLookupHint(lc && !entry ? `Kein GVL-Treffer für ${normalized}.` : null);
      if (multiTrack && markTouched) {
        const touched = new Set<string>(["labelcode"]);
        if (entry) {
          touched.add("label");
          touched.add("hersteller");
          touched.add("gvlRechte");
        }
        setMultiTouched((prev) => new Set([...prev, ...touched]));
      }
    },
    [gvlLabelDb, multiTrack]
  );

  const onLabelcodeChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value;
      if (multiTrack) setMultiTouched((prev) => new Set(prev).add("labelcode"));
      setForm((prev) => ({ ...prev, labelcode: v }));
      setLabelcodeLookupHint(null);
    },
    [multiTrack]
  );

  const onLabelcodePaste = useCallback(
    (e: ClipboardEvent<HTMLInputElement>) => {
      const pasted = e.clipboardData.getData("text");
      if (!pasted.trim()) return;
      e.preventDefault();
      applyLabelcodeWithGvlLookup(pasted, true);
    },
    [applyLabelcodeWithGvlLookup]
  );

  const onLabelcodeBlur = useCallback(
    (e: FocusEvent<HTMLInputElement>) => {
      const raw = e.currentTarget.value;
      if (!raw.trim()) {
        setLabelcodeLookupHint(null);
        return;
      }
      applyLabelcodeWithGvlLookup(raw, multiTrack);
    },
    [applyLabelcodeWithGvlLookup, multiTrack]
  );

  const fieldSetter = multiTrack ? setMultiField : setStandard;

  if (!open) return null;

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
        {multiTrack ? (
          <p className="modal-lead modal-lead--tag-multi">
            Mehrfachbearbeitung: Alle Felder starten leer. Nur Felder, die Sie ausfüllen oder ändern, werden auf{" "}
            <strong>alle</strong> ausgewählten Titel übernommen — andere Tags je Titel bleiben unverändert. Beim
            Labelcode werden bei Treffer in der GVL-Liste zusätzlich Label, Hersteller und Rechterückruf gesetzt.
          </p>
        ) : null}
        {!multiTrack && p7SearchSource?.trim() ? (
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
        {!multiTrack ? (
        <div className="tag-import-block">
          <div className="tag-import-heading">
            Text aus GEMA / Google Lens / BMG PM / Apple Music / Sonoton / Extreme Music / Earmotion /
            Blankframe
          </div>
          <textarea
            className="tag-import-textarea"
            value={pasteDraft}
            onChange={(e) => setPasteDraft(e.target.value)}
            placeholder={
              "TITEL …\nCD …\nJAHR …\n\nBlankframe z. B.:\nDystopia = Songtitel\n\nSpheric Pulses = Albumtitel"
            }
            rows={5}
            spellCheck={false}
            aria-label="Eingefügter Metadaten-Text (GEMA, Lens, Blankframe, …)"
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
        ) : null}
        <div className="tag-form">
          <label className="tag-field">
            <span>Songtitel</span>
            <input type="text" value={form.songTitle} onChange={fieldSetter("songTitle")} autoComplete="off" />
          </label>
          <label className="tag-field">
            <span>Interpret</span>
            <input type="text" value={form.artist} onChange={fieldSetter("artist")} autoComplete="off" />
          </label>
          <label className="tag-field">
            <span>Albumtitel</span>
            <input type="text" value={form.album} onChange={fieldSetter("album")} autoComplete="off" />
          </label>
          <label className="tag-field">
            <span>Jahr</span>
            <input type="text" value={form.year} onChange={fieldSetter("year")} autoComplete="off" />
          </label>
          <label className="tag-field">
            <span>Komponist</span>
            <input type="text" value={form.composer} onChange={fieldSetter("composer")} autoComplete="off" />
          </label>
          <div className="tag-field-row tag-field-row--comment-warn">
            <label className="tag-field">
              <span>Kommentar</span>
              <textarea value={form.comment} onChange={fieldSetter("comment")} rows={2} />
            </label>
            <label className="tag-field tag-field--warnung-inline">
              <span>Warnung</span>
              <input
                type="checkbox"
                className="tag-warn-switch"
                checked={warnToggle}
                onChange={(e) => {
                  if (multiTrack) setMultiTouched((prev) => new Set(prev).add("warnung"));
                  setWarnToggle(e.target.checked);
                }}
              />
            </label>
          </div>
          <label className="tag-field">
            <span>ISRC</span>
            <input type="text" value={form.isrc} onChange={fieldSetter("isrc")} autoComplete="off" />
          </label>
          <label className="tag-field">
            <span>Labelcode</span>
            <input
              type="text"
              value={form.labelcode}
              onChange={onLabelcodeChange}
              onPaste={onLabelcodePaste}
              onBlur={onLabelcodeBlur}
              autoComplete="off"
            />
          </label>
          {labelcodeLookupHint ? (
            <p className="modal-lead modal-lead--muted tag-blankframe-api-err" role="status">
              {labelcodeLookupHint}
            </p>
          ) : null}
          <label className="tag-field">
            <span>Label</span>
            <input type="text" value={form.label} onChange={fieldSetter("label")} autoComplete="off" />
          </label>
          <label className="tag-field">
            <span>Hersteller</span>
            <input type="text" value={form.hersteller} onChange={fieldSetter("hersteller")} autoComplete="off" />
          </label>
          <label className="tag-field">
            <span>{AUDIO_TAG_FIELD_LABELS.gvlRechte}</span>
            <input type="text" value={form.gvlRechte} onChange={fieldSetter("gvlRechte")} autoComplete="off" />
          </label>
        </div>
        <div className="modal-actions modal-actions--tag">
          {!multiTrack ? (
          <div className="modal-actions--tag-left">
            <button
              type="button"
              className="btn-modal btn-modal--tag-portal"
              aria-label="P7S1 Musikportal"
              title={`${P7S1_MUSIKPORTAL_TRACK_RESEARCH_URL} — kopiert zugleich den Suchbegriff (Dateiname bis zum ersten _) in die Zwischenablage.`}
              onClick={() => openP7S1MusikportalWithOptionalClip(p7SearchSource)}
            >
              <img
                src="/P7S1.png"
                alt=""
                className="btn-tag-portal-icon btn-tag-portal-icon--p7"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).src = "/p7s1.svg";
                }}
              />
            </button>
            <button
              type="button"
              className="btn-modal btn-modal--tag-portal"
              aria-label="Apple Music"
              title={`${APPLE_MUSIC_SEARCH_URL} — Suchbegriff: nach erstem „/“ nur Dateiname; mit _ alles danach, ohne _ dann ganzer Name — Bindestriche/Unterstriche als Leerzeichen; gleicher Text in Zwischenablage und Suche.`}
              onClick={() => openAppleMusicWithOptionalClip(p7SearchSource)}
            >
              <img
                src="/apple-logo.png"
                alt=""
                className="btn-tag-portal-icon btn-tag-portal-icon--apple"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).src = "/apple-logo.svg";
                }}
              />
            </button>
            <button
              type="button"
              className="btn-modal"
              title={`${UPM_SEARCH_URL} — bei Dateinamen mit Präfix UPM_: Katalogteil (z. B. ESW2878_17) in die Zwischenablage und Such-URL mit searchString.`}
              onClick={() => void openUpmSearchWithOptionalClipAsync(p7SearchSource)}
            >
              UPM-Suche
            </button>
            <button
              type="button"
              className="btn-modal"
              title={`${BMGPM_SEARCH_URL} — bei BMGPM_: Kennung nach dem ersten Unterstrich + erstes Wort des Titels (nach dem 3. Unterstrich) in die Zwischenablage, z. B. „LKY0123 RISE“.`}
              onClick={() => void openBmgPmSearchWithOptionalClipAsync(p7SearchSource)}
            >
              BMGPM-Suche
            </button>
            <button
              type="button"
              className="btn-modal"
              title={`${SONOTON_SEARCH_BASE_URL} — Suchbegriff (Dateiname bis zum ersten _) in die Zwischenablage; Suche mit vorausgefülltem Feld (search=).`}
              onClick={() => openSonotonSearchWithOptionalClip(p7SearchSource)}
            >
              Sonoton-Suche
            </button>
            <button
              type="button"
              className="btn-modal"
              title={`${EXTREME_MUSIC_URL} — Ersten Code bis zur ersten Leerzeile (z. B. aus dem Dateinamen) in die Zwischenablage; auf der Seite einfügen und Metadaten hier wieder einfügen.`}
              onClick={() => openExtremeMusicSearchWithOptionalClip(p7SearchSource)}
            >
              Extreme-Suche
            </button>
            <button
              type="button"
              className="btn-modal"
              title={`${EARMOTION_ACCOUNT_URL} — Mit „- EARMOTION“: Text davor; sonst ganzer Dateiname. Endungen .mp3/.wav werden nicht kopiert. Auf der Seite Strg+V / ⌘V.`}
              onClick={() => openEarmotionSearchWithOptionalClip(p7SearchSource)}
            >
              Earmotion-Suche
            </button>
            <button
              type="button"
              className="btn-modal"
              disabled={blankframeApiBusy}
              title={
                `API track/get/many — Wenn der Dateiname eine Katalognummer enthält (z. B. blkfr_0206-3), ` +
                `werden Metadaten geladen und Labelcode LC 95281 mit GVL ergänzt. ` +
                `Ohne Katalognummer: Website öffnen, Zwischenablage wie bisher (Songtitel-Segment).`
              }
              onClick={() => void onBlankframeSearchClick()}
            >
              {blankframeApiBusy ? "Blankframe …" : "Blankframe-Suche"}
            </button>
            <button
              type="button"
              className="btn-modal"
              disabled={wcpmApiBusy}
              title="Zeile aus der hochgeladenen WCPM-Excel (Verwaltung → Musikverlage) per Dateiname (Spalte FILENAME; .wav/.mp3 wird ignoriert). Labelcode mit LC …; GVL-Ergänzung wenn vorhanden."
              onClick={() => void onWcpmLookupClick()}
            >
              {wcpmApiBusy ? "WCPM …" : "WCPM"}
            </button>
            {blankframeApiErr ? (
              <p className="modal-lead modal-lead--muted tag-blankframe-api-err" role="alert">
                {blankframeApiErr}
              </p>
            ) : null}
            {wcpmApiErr ? (
              <p className="modal-lead modal-lead--muted tag-blankframe-api-err" role="alert">
                {wcpmApiErr}
              </p>
            ) : null}
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
          ) : (
            <div className="modal-actions--tag-left" aria-hidden />
          )}
          <div className="modal-actions--tag-right">
            <button type="button" className="btn-modal" onClick={onClose}>
              Abbrechen
            </button>
            <button
              type="button"
              className="btn-modal primary"
              disabled={saveBusy || (multiTrack && multiTouched.size === 0)}
              onClick={() => {
                if (saveBusy) return;
                if (multiTrack && multiTouched.size === 0) return;
                setSaveBusy(true);
                const tags = formToAudioTags(form, warnToggle);
                const p = multiTrack
                  ? Promise.resolve(
                      onSave(tags, { multi: true, touchedKeys: [...multiTouched] })
                    )
                  : Promise.resolve(onSave(tags));
                void p.finally(() => {
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
