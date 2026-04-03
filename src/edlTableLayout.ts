import {
  AUDIO_TAG_FIELD_LABELS,
  AUDIO_TAG_TABLE_COLUMN_KEYS,
} from "./audio/audioTags";
import { TAG_COLUMN_MIN_WIDTHS } from "./tableColumnLayout";

const LS_KEY = "musiclist-edl-table-layout-v1";

export const EDL_FIXED_COLUMN_IDS = ["num", "track", "tcIn", "tcOut", "duration", "title"] as const;
export type EdlFixedColumnId = (typeof EDL_FIXED_COLUMN_IDS)[number];

export type EdlTableColumnId = EdlFixedColumnId | (typeof AUDIO_TAG_TABLE_COLUMN_KEYS)[number];

export const EDL_TABLE_ALL_COLUMN_IDS: EdlTableColumnId[] = [
  ...EDL_FIXED_COLUMN_IDS,
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

export function getEdlColumnLabel(id: EdlTableColumnId): string {
  switch (id) {
    case "num":
      return "#";
    case "track":
      return "Spur";
    case "tcIn":
      return "TC-In";
    case "tcOut":
      return "TC-Out";
    case "duration":
      return "Duration";
    case "title":
      return "Titel / Quelle";
    default:
      return AUDIO_TAG_FIELD_LABELS[id];
  }
}

export function edlResizeMinForColumnId(id: EdlTableColumnId): number {
  if (id === "num") return headerMinPx("#");
  if (id === "track") return headerMinPx("Spur");
  if (id === "tcIn") return headerMinPx("TC-In");
  if (id === "tcOut") return headerMinPx("TC-Out");
  if (id === "duration") return headerMinPx("Duration");
  if (id === "title") return headerMinPx("Titel / Quelle");
  return TAG_COLUMN_MIN_WIDTHS[id] ?? 28;
}

/** Obergrenze pro Spalte (verhindert kaputte localStorage-Werte und zu breite #/TC-Spalten). */
export function edlColumnWidthMax(id: EdlTableColumnId): number {
  switch (id) {
    case "num":
      return 120;
    case "track":
      return 240;
    case "tcIn":
    case "tcOut":
      return 200;
    case "duration":
      return 160;
    case "title":
      return 5600;
    default:
      return 4000;
  }
}

export function sanitizeEdlColumnWidths(
  widths: Record<EdlTableColumnId, number>
): Record<EdlTableColumnId, number> {
  const o = { ...widths };
  for (const id of EDL_TABLE_ALL_COLUMN_IDS) {
    const min = edlResizeMinForColumnId(id);
    const max = edlColumnWidthMax(id);
    const w = o[id] ?? min;
    o[id] = Math.min(max, Math.max(min, w));
  }
  return o;
}

export function defaultEdlColumnWidthsById(): Record<EdlTableColumnId, number> {
  const o = {} as Record<EdlTableColumnId, number>;
  o.num = Math.max(defaultWidthFromMin(edlResizeMinForColumnId("num")), 56);
  o.track = Math.max(defaultWidthFromMin(edlResizeMinForColumnId("track")), 52);
  o.tcIn = defaultWidthFromMin(edlResizeMinForColumnId("tcIn"));
  o.tcOut = defaultWidthFromMin(edlResizeMinForColumnId("tcOut"));
  o.duration = defaultWidthFromMin(edlResizeMinForColumnId("duration"));
  o.title = Math.max(defaultWidthFromMin(edlResizeMinForColumnId("title")), 200);
  for (const k of AUDIO_TAG_TABLE_COLUMN_KEYS) {
    o[k] = defaultWidthFromMin(edlResizeMinForColumnId(k));
  }
  return o;
}

export function mergeVisibleOrderIntoFull(
  fullOrder: EdlTableColumnId[],
  hidden: Set<EdlTableColumnId>,
  visPrime: EdlTableColumnId[]
): EdlTableColumnId[] {
  const iter = [...visPrime];
  return fullOrder.map((id) => (hidden.has(id) ? id : iter.shift()!));
}

export function reorderEdlColumns(
  fullOrder: EdlTableColumnId[],
  hidden: Set<EdlTableColumnId>,
  fromId: EdlTableColumnId,
  toId: EdlTableColumnId
): EdlTableColumnId[] {
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

export type EdlTableLayoutState = {
  order: EdlTableColumnId[];
  hidden: Set<EdlTableColumnId>;
  widths: Record<EdlTableColumnId, number>;
};

function isValidOrder(order: unknown): order is EdlTableColumnId[] {
  if (!Array.isArray(order) || order.length !== EDL_TABLE_ALL_COLUMN_IDS.length) return false;
  const s = new Set(order);
  if (s.size !== EDL_TABLE_ALL_COLUMN_IDS.length) return false;
  return EDL_TABLE_ALL_COLUMN_IDS.every((id) => s.has(id));
}

export function loadEdlTableLayout(): EdlTableLayoutState {
  const defaults: EdlTableLayoutState = {
    order: [...EDL_TABLE_ALL_COLUMN_IDS],
    hidden: new Set(),
    widths: defaultEdlColumnWidthsById(),
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
    const hidden = new Set<EdlTableColumnId>();
    if (Array.isArray(parsed.hidden)) {
      for (const h of parsed.hidden) {
        if (typeof h === "string" && EDL_TABLE_ALL_COLUMN_IDS.includes(h as EdlTableColumnId)) {
          hidden.add(h as EdlTableColumnId);
        }
      }
    }
    const widths = { ...defaults.widths };
    if (parsed.widths && typeof parsed.widths === "object") {
      for (const id of EDL_TABLE_ALL_COLUMN_IDS) {
        const w = (parsed.widths as Record<string, unknown>)[id];
        if (typeof w === "number" && w >= 28 && w < 4000) widths[id] = w;
      }
    }
    if (EDL_TABLE_ALL_COLUMN_IDS.length - hidden.size < 1) {
      return defaults;
    }
    return { order, hidden, widths: sanitizeEdlColumnWidths(widths) };
  } catch {
    return defaults;
  }
}

export function saveEdlTableLayout(state: EdlTableLayoutState): void {
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

export function emptyEdlFiltersRecord(): Record<EdlTableColumnId, string> {
  const o = {} as Record<EdlTableColumnId, string>;
  for (const id of EDL_TABLE_ALL_COLUMN_IDS) o[id] = "";
  return o;
}
