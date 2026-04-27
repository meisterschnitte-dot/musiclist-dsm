import {
  useCallback,
  useEffect,
  useMemo,
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
  findGvlEntryByLabel,
  findGvlEntryByLabelcode,
  loadGvlLabelDb,
  type GvlLabelDb,
  type GvlLabelEntry,
} from "../storage/gvlLabelStore";
import { parseGemaOcrText } from "../audio/parseGemaOcrText";
import {
  looksLikeCezameMetadataText,
  parseCezameMetadataText,
} from "../audio/parseCezameMetadataText";
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
import { APL_PUBLISHING_URL, openAplPublishingSearchWithOptionalClipAsync } from "../aplPublishingSearch";
import { BIBLIOTHEQUE_MUSIC_URL, openBibliothequeMusicWithOptionalClipAsync } from "../bibliothequeMusic";
import {
  AUDIONETWORK_DE_SEARCH_URL,
  openAudioNetworkSearchWithOptionalClipAsync,
} from "../audioNetwork";
import { CEZAME_DE_URL, openCezameSearchWithOptionalClipAsync } from "../cezameSearch";
import {
  looksLikeAudioNetworkMetadataText,
  parseAudioNetworkMetadataText,
} from "../audio/parseAudioNetworkMetadataText";
import {
  looksLikeBibliothequeMusicMetadataText,
  parseBibliothequeMusicMetadataText,
} from "../audio/parseBibliothequeMusicMetadataText";
import { extractSonoFindMmdTrackcodeFromFilename, SONOTON_MMD_BASE_URL } from "../sonotonSearch";
import { apiSonofindMmdFetch } from "../api/sonofindMmdApi";
import { parseSonofindMmdXml } from "../audio/parseSonofindMmdXml";
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
  looksLikeAplPublishingMetadata,
  parseAplPublishingMetadataText,
} from "../audio/parseAplPublishingMetadataText";
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
import { apiSharedMusicDbFetch } from "../api/sharedTracksApi";
import { basenamePath } from "../tracks/sanitizeFilename";
import {
  getMp3ColumnLabel,
  MP3_TABLE_ALL_COLUMN_IDS,
  type Mp3TableColumnId,
} from "../mp3TableLayout";

export type TagEditorMusicDbAutoSearchResult = { noFurtherMatch: true };

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
  /**
   * Server-Musikdatenbank: gleiche Trefferlogik wie „Transfer to MP3“ (exakter/ähnlicher Dateiname).
   * Erhält aktuelle Tag-Felder aus dem Formular.
   */
  onMusicDatabaseSearch?: (
    getCurrentTags: () => AudioTags
  ) => void | Promise<void | TagEditorMusicDbAutoSearchResult>;
  /** MP3-Pfad aus manueller Suche dem bearbeiteten Eintrag zuordnen. */
  onManualMusicDbAssign?: (relativePath: string) => void | Promise<void>;
  /** Sichtbare Spalten wie in der Musikdatenbank (Reihenfolge). */
  manualMusicDbColumnIds?: Mp3TableColumnId[] | null;
  /** Zelltexte je Spalte wie in der Haupttabelle (`buildMp3RowCellsMap`). */
  getManualMusicDbRowCells?: (
    relativePath: string,
    displayIndexOneBased: number
  ) => Record<Mp3TableColumnId, string>;
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
  onMusicDatabaseSearch,
  onManualMusicDbAssign,
  manualMusicDbColumnIds = null,
  getManualMusicDbRowCells,
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
  const [sonotonMmdBusy, setSonotonMmdBusy] = useState(false);
  const [sonotonMmdErr, setSonotonMmdErr] = useState<string | null>(null);
  const [labelcodeLookupHint, setLabelcodeLookupHint] = useState<string | null>(null);
  const [musicDbSearchBusy, setMusicDbSearchBusy] = useState(false);
  const [musicDbNoMatchHint, setMusicDbNoMatchHint] = useState<string | null>(null);
  const [manualSearchOpen, setManualSearchOpen] = useState(false);
  const [manualAllPaths, setManualAllPaths] = useState<string[]>([]);
  const [manualPathsBusy, setManualPathsBusy] = useState(false);
  const [manualPathsErr, setManualPathsErr] = useState<string | null>(null);
  const [manualSearchQuery, setManualSearchQuery] = useState("");
  const [manualSelectedPath, setManualSelectedPath] = useState<string | null>(null);
  const [manualAssignBusy, setManualAssignBusy] = useState(false);

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
    setMusicDbNoMatchHint(null);
  }, [open, initial, multiTrack]);

  useEffect(() => {
    if (!manualSearchOpen || !open) return;
    let cancelled = false;
    setManualPathsErr(null);
    setManualPathsBusy(true);
    void (async () => {
      try {
        const { paths } = await apiSharedMusicDbFetch();
        if (!cancelled) setManualAllPaths(paths);
      } catch (e) {
        if (!cancelled) {
          setManualPathsErr(e instanceof Error ? e.message : "Musikdatenbank konnte nicht geladen werden.");
        }
      } finally {
        if (!cancelled) setManualPathsBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [manualSearchOpen, open]);

  const manualFilteredPaths = useMemo(() => {
    const q = manualSearchQuery.trim().toLowerCase();
    if (!manualAllPaths.length) return [];
    if (!q) return manualAllPaths.slice(0, 400);
    const out: string[] = [];
    for (const p of manualAllPaths) {
      const n = p.replace(/\\/g, "/").toLowerCase();
      const base = basenamePath(p).toLowerCase();
      if (n.includes(q) || base.includes(q)) {
        out.push(p);
        if (out.length >= 400) break;
      }
    }
    return out;
  }, [manualAllPaths, manualSearchQuery]);

  const manualTruncated =
    manualAllPaths.length > 0 &&
    (manualSearchQuery.trim()
      ? manualFilteredPaths.length >= 400
      : manualAllPaths.length > 400);

  const manualDbColumnIds = useMemo((): Mp3TableColumnId[] => {
    if (manualMusicDbColumnIds && manualMusicDbColumnIds.length > 0) return manualMusicDbColumnIds;
    return [...MP3_TABLE_ALL_COLUMN_IDS];
  }, [manualMusicDbColumnIds]);

  const manualDbRows = useMemo(() => {
    if (!manualSearchOpen) return [];
    return manualFilteredPaths.map((p, i) => {
      const displayIdx = i + 1;
      const cells: Record<Mp3TableColumnId, string> = getManualMusicDbRowCells
        ? getManualMusicDbRowCells(p, displayIdx)
        : Object.fromEntries(
            manualDbColumnIds.map((id) => [
              id,
              id === "filename" ? p.replace(/\\/g, "/") : "—",
            ])
          ) as Record<Mp3TableColumnId, string>;
      return { path: p, cells };
    });
  }, [manualSearchOpen, manualFilteredPaths, getManualMusicDbRowCells, manualDbColumnIds]);

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
    const { fields, extraCommentLines } = looksLikeAplPublishingMetadata(pasteDraft)
      ? parseAplPublishingMetadataText(pasteDraft)
      : looksLikeBmgPmMetadata(pasteDraft)
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
                : looksLikeAudioNetworkMetadataText(pasteDraft)
                  ? parseAudioNetworkMetadataText(pasteDraft)
                : looksLikeBibliothequeMusicMetadataText(pasteDraft)
                  ? parseBibliothequeMusicMetadataText(pasteDraft)
                  : looksLikeCezameMetadataText(pasteDraft)
                    ? parseCezameMetadataText(pasteDraft)
                    : parseGemaOcrText(pasteDraft);
    let mergedFields: Partial<AudioTags> = { ...fields };
    const db = gvlLabelDb ?? loadGvlLabelDb();
    const labelTrim = mergedFields.label?.trim();
    const lcTrim = mergedFields.labelcode?.trim();
    const aplPaste = looksLikeAplPublishingMetadata(pasteDraft);
    const bmgPaste = looksLikeBmgPmMetadata(pasteDraft);
    const bibliothequePaste = looksLikeBibliothequeMusicMetadataText(pasteDraft);
    const audioNetworkPaste = looksLikeAudioNetworkMetadataText(pasteDraft);
    let entry: GvlLabelEntry | undefined;
    if (aplPaste || bmgPaste || bibliothequePaste || audioNetworkPaste) {
      if (labelTrim) entry = findGvlEntryByLabel(db, labelTrim);
      if (!entry && lcTrim) entry = findGvlEntryByLabelcode(db, lcTrim);
    } else {
      if (lcTrim) entry = findGvlEntryByLabelcode(db, lcTrim);
      if (!entry && labelTrim) entry = findGvlEntryByLabel(db, labelTrim);
    }
    if (entry) {
      mergedFields = {
        ...mergedFields,
        label: entry.label,
        labelcode: labelcodeWithLcPrefix(String(entry.labelcode ?? "").trim()),
        hersteller: entry.hersteller,
        gvlRechte: entry.rechterueckrufe,
      };
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

  const onSonotonMmdClick = useCallback(async () => {
    setSonotonMmdErr(null);
    const src = p7SearchSource?.trim();
    if (!src) {
      setSonotonMmdErr("Kein Dateiname für SonoFind.");
      return;
    }
    const code = extractSonoFindMmdTrackcodeFromFilename(src);
    if (!code) {
      setSonotonMmdErr(
        "Im Dateinamen wurde kein MMD-Trackcode erkannt (Kennung oft zwischen _ … _, z. B. „AB-C032633“, „AB-27473893“ oder ohne Bindestrich „sk8463637464“ — min. 7 Zeichen, mit Ziffern)."
      );
      return;
    }
    setSonotonMmdBusy(true);
    try {
      const xml = await apiSonofindMmdFetch(code);
      const partial = parseSonofindMmdXml(xml, code);
      setForm((prev) => {
        const next = { ...prev };
        for (const k of Object.keys(partial) as (keyof typeof partial)[]) {
          if (k === "warnung") continue;
          const v = partial[k as keyof typeof partial];
          if (typeof v !== "string" || !v.trim()) continue;
          (next as Record<string, string>)[k] = v.trim();
        }
        const db = gvlLabelDb ?? loadGvlLabelDb();
        const lc = next.labelcode?.trim();
        let entry: GvlLabelEntry | undefined;
        if (lc) entry = findGvlEntryByLabelcode(db, lc);
        if (!entry && next.label?.trim()) entry = findGvlEntryByLabel(db, next.label.trim());
        if (entry) {
          next.label = entry.label;
          next.labelcode = labelcodeWithLcPrefix(String(entry.labelcode ?? "").trim());
          next.hersteller = entry.hersteller;
          next.gvlRechte = entry.rechterueckrufe;
        }
        return next;
      });
    } catch (e) {
      setSonotonMmdErr(e instanceof Error ? e.message : "SonoFind MMD fehlgeschlagen.");
    } finally {
      setSonotonMmdBusy(false);
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
            Text aus GEMA / Google Lens / BMG PM / Apple Music / Audio Network (Titel, Tabelle) /
            Bibliothèque (Track, Code, Publisher, …) / Cézame (Titre, LC, ISRC, …) / Sonoton / Extreme
            Music / Earmotion / Blankframe
          </div>
          <textarea
            className="tag-import-textarea"
            value={pasteDraft}
            onChange={(e) => setPasteDraft(e.target.value)}
            placeholder={
              "TITEL …\nCD …\nJAHR …\n\nCézame z. B.:\nTitre :  A Part of Me = Songtitel\nLC :  10347 = Labelcode\n\nBlankframe z. B.:\nDystopia = Songtitel"
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
              UPM
            </button>
            <button
              type="button"
              className="btn-modal"
              title={`${BMGPM_SEARCH_URL} — bei BMGPM_: Kennung nach dem ersten Unterstrich + erstes Wort des Titels (nach dem 3. Unterstrich) in die Zwischenablage, z. B. „LKY0123 RISE“.`}
              onClick={() => void openBmgPmSearchWithOptionalClipAsync(p7SearchSource)}
            >
              BMGPM
            </button>
            <button
              type="button"
              className="btn-modal"
              title={`${APL_PUBLISHING_URL} — nach erstem „_“: z. B. APL 517_… in die Zwischenablage, dann APL-Website. Metadaten unten einfügen und „Felder übernehmen“ — GVL per Label.`}
              onClick={() => void openAplPublishingSearchWithOptionalClipAsync(p7SearchSource)}
            >
              APL
            </button>
            <button
              type="button"
              className="btn-modal"
              aria-label="Audio Network de.audionetwork.com"
              title={`${AUDIONETWORK_DE_SEARCH_URL} — Trackcode: Zeichenkette ab Dateibeginn bis vor dem ersten Unterstrich (z. B. ANW3920_… → ANW3920) in die Zwischenablage; Suche in neuem Tab (Suchfeld: Strg+V / ⌘V). Tabelle (Title, …, ISRC, Labelcode) unten einfügen — GVL per Label, dann Labelcode.`}
              onClick={() => void openAudioNetworkSearchWithOptionalClipAsync(p7SearchSource)}
            >
              AN
            </button>
            <button
              type="button"
              className="btn-modal"
              aria-label="Bibliothèque Music bibliothequemusic.com"
              title={`${BIBLIOTHEQUE_MUSIC_URL} — Trackcode: optional mit Doppelpunkt im Stamm, wie CEZ: zwischen erstem und zweitem Unterstrich; bei nur einem Unterstrich: Rest nach dem Unterstrich. Zwischenablage; Suchseite mit ?q= (fällt ggf. zurück — dann einfügen).`}
              onClick={() => void openBibliothequeMusicWithOptionalClipAsync(p7SearchSource)}
            >
              BC
            </button>
            <button
              type="button"
              className="btn-modal"
              aria-label="Cézame de.cezamemusic.com"
              title={`${CEZAME_DE_URL} — Trackcode = Text zwischen dem ersten und zweiten Unterstrich im Dateinamen, wird in die Zwischenablage kopiert; Cézame-Seite öffnet im neuen Tab — Suchfeld: Strg+V / ⌘V (direktes Vorbefüllen durch die Seite ist nicht vorgesehen).`}
              onClick={() => void openCezameSearchWithOptionalClipAsync(p7SearchSource)}
            >
              CEZ
            </button>
            <button
              type="button"
              className="btn-modal"
              disabled={sonotonMmdBusy}
              title={
                `${SONOTON_MMD_BASE_URL} — Öffentliches MMD-XML (Trackcode aus dem Dateinamen, ` +
                `z. B. „AB-C032633“ / „sk8463637464“ in einem per _ getrennten Segment; Tags füllen, GVL-Abgleich aus Label/Labelcode.`
              }
              onClick={() => void onSonotonMmdClick()}
            >
              {sonotonMmdBusy ? "SonoFind …" : "Sonoton"}
            </button>
            <button
              type="button"
              className="btn-modal"
              title={`${EXTREME_MUSIC_URL} — Ersten Code bis zur ersten Leerzeile (z. B. aus dem Dateinamen) in die Zwischenablage; auf der Seite einfügen und Metadaten hier wieder einfügen.`}
              onClick={() => openExtremeMusicSearchWithOptionalClip(p7SearchSource)}
            >
              Extreme
            </button>
            <button
              type="button"
              className="btn-modal"
              title={`${EARMOTION_ACCOUNT_URL} — Mit „- EARMOTION“: Text davor; sonst ganzer Dateiname. Endungen .mp3/.wav werden nicht kopiert. Auf der Seite Strg+V / ⌘V.`}
              onClick={() => openEarmotionSearchWithOptionalClip(p7SearchSource)}
            >
              Earmotion
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
              {blankframeApiBusy ? "Blankframe …" : "Blankframe"}
            </button>
            <button
              type="button"
              className="btn-modal"
              disabled={wcpmApiBusy}
              title="Zeile aus der hochgeladenen WCPM-Excel (Verwaltung → Musikverlage) per Dateiname (Spalte FILENAME; .wav/.mp3 wird ignoriert). Kennung z. B. CAR439_014 oder CAR439 014 (Leerzeichen statt _). Labelcode mit LC …; GVL-Ergänzung wenn vorhanden."
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
            {sonotonMmdErr ? (
              <p className="modal-lead modal-lead--muted tag-blankframe-api-err" role="alert">
                {sonotonMmdErr}
              </p>
            ) : null}
            {onMusicDatabaseSearch ? (
              <button
                type="button"
                className="btn-modal btn-modal--tag-portal btn-modal--music-db-search"
                disabled={musicDbSearchBusy}
                aria-label="Suche in Datenbank"
                title="Musikdatenbank durchsuchen — wie beim Transfer zu MP3: gleicher oder sehr ähnlicher Dateiname (Treffer-Dialog)."
                onClick={() => {
                  if (musicDbSearchBusy) return;
                  setMusicDbNoMatchHint(null);
                  setMusicDbSearchBusy(true);
                  const p = onMusicDatabaseSearch(() => formToAudioTags(form, warnToggle));
                  void Promise.resolve(p)
                    .then((r) => {
                      if (r?.noFurtherMatch) {
                        setMusicDbNoMatchHint(
                          "Kein passender Titel gefunden (gleicher oder sehr ähnlicher Dateiname)."
                        );
                      }
                    })
                    .finally(() => {
                      if (saveMountedRef.current) setMusicDbSearchBusy(false);
                    });
                }}
              >
                <span className="btn-tag-music-db-icon" aria-hidden>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <ellipse cx="12" cy="6" rx="7" ry="3" stroke="currentColor" strokeWidth="1.5" />
                    <path
                      d="M5 6v4c0 1.66 3.13 3 7 3s7-1.34 7-3V6"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    />
                    <path
                      d="M5 10v4c0 1.66 3.13 3 7 3s7-1.34 7-3v-4"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    />
                    <ellipse cx="12" cy="18" rx="7" ry="3" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                </span>
              </button>
            ) : null}
            {onManualMusicDbAssign ? (
              <button
                type="button"
                className="btn-modal btn-modal--tag-portal btn-modal--manual-music-search"
                disabled={manualAssignBusy}
                aria-label="Manuelle Suche in der Musikdatenbank"
                title="Manuelle Suche: MP3 in der Musikdatenbank filtern und diesem Eintrag zuordnen."
                onClick={() => {
                  setMusicDbNoMatchHint(null);
                  setManualSearchQuery("");
                  setManualSelectedPath(null);
                  setManualSearchOpen(true);
                }}
              >
                <span className="btn-tag-manual-search-icon" aria-hidden>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.75" />
                    <path
                      d="M15.2 15.2 21 21"
                      stroke="currentColor"
                      strokeWidth="1.75"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
              </button>
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
        {!multiTrack && musicDbNoMatchHint ? (
          <p className="tag-editor-musicdb-footer-hint" role="status">
            {musicDbNoMatchHint}
          </p>
        ) : null}
      </div>
      {manualSearchOpen && onManualMusicDbAssign ? (
        <div
          className="modal-backdrop modal-backdrop--tag-manual-db"
          role="dialog"
          aria-modal="true"
          aria-labelledby="tag-manual-db-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setManualSearchOpen(false);
          }}
        >
          <div className="modal modal--tag-manual-db" onMouseDown={(e) => e.stopPropagation()}>
            <h2 id="tag-manual-db-title" className="modal-title">
              MP3 aus Musikdatenbank zuordnen
            </h2>
            <p className="modal-lead modal-lead--muted tag-manual-db-lead">
              Eintrag filtern, Zeile wählen, dann zuordnen — die Verknüpfung und die angezeigten Tags werden wie
              bei einer neuen MP3-Verknüpfung gesetzt.
            </p>
            <label className="tag-manual-db-filter-label" htmlFor="tag-manual-db-filter">
              Filter (Pfad oder Dateiname)
            </label>
            <input
              id="tag-manual-db-filter"
              className="modal-dup-tag-form-input tag-manual-db-filter-input"
              type="search"
              autoComplete="off"
              spellCheck={false}
              placeholder="z. B. Ordnername oder Teil des Dateinamens"
              value={manualSearchQuery}
              onChange={(e) => {
                setManualSearchQuery(e.target.value);
                setManualSelectedPath(null);
              }}
            />
            {manualPathsBusy ? (
              <p className="modal-lead modal-lead--muted" role="status">
                Musikdatenbank wird geladen …
              </p>
            ) : manualPathsErr ? (
              <p className="modal-lead tag-blankframe-api-err" role="alert">
                {manualPathsErr}
              </p>
            ) : (
              <>
                <p className="tag-manual-db-count mono-cell" aria-live="polite">
                  {manualFilteredPaths.length} Treffer
                  {manualTruncated ? " (max. 400 angezeigt — Filter verfeinern)" : ""}
                  {manualAllPaths.length > 0 && !manualSearchQuery.trim()
                    ? ` · ${manualAllPaths.length} MP3 gesamt`
                    : ""}
                </p>
                <div className="tag-manual-db-table-scroll" role="region" aria-label="Musikdatenbank-Treffer">
                  <table className="tag-manual-db-table">
                    <thead>
                      <tr>
                        {manualDbColumnIds.map((colId) => (
                          <th key={colId} scope="col" className="tag-manual-db-th">
                            {getMp3ColumnLabel(colId)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {manualDbRows.map(({ path: p, cells }) => {
                        const selected = manualSelectedPath === p;
                        return (
                          <tr
                            key={p}
                            className={
                              selected
                                ? "tag-manual-db-tr tag-manual-db-tr--selected"
                                : "tag-manual-db-tr"
                            }
                            onClick={() => setManualSelectedPath(p)}
                            onDoubleClick={() => {
                              setManualSelectedPath(p);
                              setManualAssignBusy(true);
                              const done = onManualMusicDbAssign(p);
                              void Promise.resolve(done).finally(() => {
                                if (saveMountedRef.current) {
                                  setManualAssignBusy(false);
                                  setManualSearchOpen(false);
                                }
                              });
                            }}
                          >
                            {manualDbColumnIds.map((colId) => {
                              const text = cells[colId] ?? "—";
                              return (
                                <td
                                  key={colId}
                                  className={
                                    colId === "filename"
                                      ? "tag-manual-db-td mono-cell"
                                      : "tag-manual-db-td"
                                  }
                                  title={text}
                                >
                                  {text}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            <div className="modal-actions">
              <button type="button" className="btn-modal" onClick={() => setManualSearchOpen(false)}>
                Abbrechen
              </button>
              <button
                type="button"
                className="btn-modal primary"
                disabled={!manualSelectedPath || manualAssignBusy || manualPathsBusy}
                onClick={() => {
                  if (!manualSelectedPath) return;
                  setManualAssignBusy(true);
                  const done = onManualMusicDbAssign(manualSelectedPath);
                  void Promise.resolve(done).finally(() => {
                    if (saveMountedRef.current) {
                      setManualAssignBusy(false);
                      setManualSearchOpen(false);
                    }
                  });
                }}
              >
                {manualAssignBusy ? "Zuordnen …" : "Diesen Titel zuordnen"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
