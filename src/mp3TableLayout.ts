import {
  AUDIO_TAG_FIELD_LABELS,
  AUDIO_TAG_TABLE_COLUMN_KEYS,
} from "./audio/audioTags";
import { TAG_COLUMN_MIN_WIDTHS } from "./tableColumnLayout";

const LS_KEY = "musiclist-mp3-table-layout-v1";

/** Feste Spalten der Musikdatenbank (ohne ID3-Tags). */
export const MP3_FIXED_COLUMN_IDS = ["num", "filename", "created", "edited"] as const;
export type Mp3FixedColumnId = (typeof MP3_FIXED_COLUMN_IDS)[number];

export type Mp3TableColumnId = Mp3FixedColumnId | (typeof AUDIO_TAG_TABLE_COLUMN_KEYS)[number];

export const MP3_TABLE_ALL_COLUMN_IDS: Mp3TableColumnId[] = [
  ...MP3_FIXED_COLUMN_IDS,
  ...AUDIO_TAG_TABLE_COLUMN_KEYS,
];

function headerMinPx(label: string): number {
  const pad = 26;
  const perChar = 6.4;
  return Math.min(168, Math.max(28, Math.ceil(label.length * perChar + pad)));
}

function defaultWidthFromMin(min: number): number {
  return Math.round(min * 1.28 + 16);
}

export function getMp3ColumnLabel(id: Mp3TableColumnId): string {
  switch (id) {
    case "num":
      return "#";
    case "filename":
      return "Dateiname";
    case "created":
      return "Erstellt";
    case "edited":
      return "Bearbeitet";
    default:
      return AUDIO_TAG_FIELD_LABELS[id];
  }
}

export function mp3ResizeMinForColumnId(id: Mp3TableColumnId): number {
  if (id === "num") return Math.max(headerMinPx("#"), 28);
  if (id === "filename") return headerMinPx("Dateiname");
  if (id === "created") return headerMinPx("Erstellt");
  if (id === "edited") return headerMinPx("Bearbeitet");
  return TAG_COLUMN_MIN_WIDTHS[id] ?? 28;
}

export function defaultMp3ColumnWidthsById(): Record<Mp3TableColumnId, number> {
  const o = {} as Record<Mp3TableColumnId, number>;
  o.num = Math.max(defaultWidthFromMin(mp3ResizeMinForColumnId("num")), 108);
  o.filename = Math.max(defaultWidthFromMin(mp3ResizeMinForColumnId("filename")), 300);
  o.created = Math.max(defaultWidthFromMin(mp3ResizeMinForColumnId("created")), 132);
  o.edited = Math.max(defaultWidthFromMin(mp3ResizeMinForColumnId("edited")), 132);
  for (const k of AUDIO_TAG_TABLE_COLUMN_KEYS) {
    o[k] = defaultWidthFromMin(mp3ResizeMinForColumnId(k));
  }
  return o;
}

export function mergeVisibleOrderIntoFull(
  fullOrder: Mp3TableColumnId[],
  hidden: Set<Mp3TableColumnId>,
  visPrime: Mp3TableColumnId[]
): Mp3TableColumnId[] {
  const iter = [...visPrime];
  return fullOrder.map((id) => (hidden.has(id) ? id : iter.shift()!));
}

/** Sichtbare Spalte an Zielposition schieben (Reihenfolge nur unter sichtbaren Spalten). */
export function reorderMp3Columns(
  fullOrder: Mp3TableColumnId[],
  hidden: Set<Mp3TableColumnId>,
  fromId: Mp3TableColumnId,
  toId: Mp3TableColumnId
): Mp3TableColumnId[] {
  if (fromId === toId) return fullOrder;
  const vis = fullOrder.filter((id) => !hidden.has(id));
  const from = vis.indexOf(fromId);
  const to = vis.indexOf(toId);
  if (from < 0 || to < 0) return fullOrder;
  const next = [...vis];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return mergeVisibleOrderIntoFull(fullOrder, hidden, next);
}

export type Mp3TableLayoutState = {
  order: Mp3TableColumnId[];
  hidden: Set<Mp3TableColumnId>;
  widths: Record<Mp3TableColumnId, number>;
};

function isValidOrder(order: unknown): order is Mp3TableColumnId[] {
  if (!Array.isArray(order) || order.length !== MP3_TABLE_ALL_COLUMN_IDS.length) return false;
  const s = new Set(order);
  if (s.size !== MP3_TABLE_ALL_COLUMN_IDS.length) return false;
  return MP3_TABLE_ALL_COLUMN_IDS.every((id) => s.has(id));
}

export function loadMp3TableLayout(): Mp3TableLayoutState {
  const defaults: Mp3TableLayoutState = {
    order: [...MP3_TABLE_ALL_COLUMN_IDS],
    hidden: new Set(),
    widths: defaultMp3ColumnWidthsById(),
  };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as {
      order?: unknown;
      hidden?: unknown;
      widths?: unknown;
    };
    const order = isValidOrder(parsed.order) ? parsed.order : defaults.order;
    const hidden = new Set<Mp3TableColumnId>();
    if (Array.isArray(parsed.hidden)) {
      for (const h of parsed.hidden) {
        if (typeof h === "string" && MP3_TABLE_ALL_COLUMN_IDS.includes(h as Mp3TableColumnId)) {
          hidden.add(h as Mp3TableColumnId);
        }
      }
    }
    const widths = { ...defaults.widths };
    if (parsed.widths && typeof parsed.widths === "object") {
      for (const id of MP3_TABLE_ALL_COLUMN_IDS) {
        const w = (parsed.widths as Record<string, unknown>)[id];
        if (typeof w === "number" && w >= 28 && w < 4000) widths[id] = w;
      }
    }
    const visibleCount = MP3_TABLE_ALL_COLUMN_IDS.length - hidden.size;
    if (visibleCount < 1) {
      return defaults;
    }
    return { order, hidden, widths };
  } catch {
    return defaults;
  }
}

export function saveMp3TableLayout(state: Mp3TableLayoutState): void {
  try {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        order: state.order,
        hidden: [...state.hidden],
        widths: state.widths,
      })
    );
  } catch {
    /* optional */
  }
}

export function emptyMp3FiltersRecord(): Record<Mp3TableColumnId, string> {
  const o = {} as Record<Mp3TableColumnId, string>;
  for (const id of MP3_TABLE_ALL_COLUMN_IDS) o[id] = "";
  return o;
}
