import { AUDIO_TAG_FIELD_LABELS, AUDIO_TAG_TABLE_COLUMN_KEYS } from "../audio/audioTags";
import { TABLE_COL_WIDTH_MAX, TAG_COLUMN_MIN_WIDTHS } from "../tableColumnLayout";

const LS_KEY = "musiclist-player-catalog-table-v3";

export const PLAYER_CATALOG_FIXED_IDS = ["file", "ingestAt", "duration", "add"] as const;
export type PlayerCatalogFixedId = (typeof PLAYER_CATALOG_FIXED_IDS)[number];
export type PlayerCatalogColumnId = PlayerCatalogFixedId | (typeof AUDIO_TAG_TABLE_COLUMN_KEYS)[number];

export const PLAYER_CATALOG_ALL_COLUMN_IDS: PlayerCatalogColumnId[] = [
  "add",
  "file",
  "ingestAt",
  ...AUDIO_TAG_TABLE_COLUMN_KEYS,
  "duration",
];

export const PLAYER_CATALOG_FILTER_IDS: PlayerCatalogColumnId[] = PLAYER_CATALOG_ALL_COLUMN_IDS.filter(
  (id) => id !== "add"
);

export const PLAYER_CATALOG_COL_DRAG_MIME = "application/x-musiclist-player-catalog-col";

function headerMinPx(label: string): number {
  const pad = 26;
  const perChar = 6.4;
  return Math.min(168, Math.max(28, Math.ceil(label.length * perChar + pad)));
}

function defaultWidthFromMin(min: number): number {
  return Math.round(min * 1.28 + 16);
}

export function getPlayerCatalogColumnLabel(id: PlayerCatalogColumnId): string {
  switch (id) {
    case "file":
      return "Datei";
    case "ingestAt":
      return "Ingest Datum";
    case "duration":
      return "Dauer";
    case "add":
      return "";
    default:
      return AUDIO_TAG_FIELD_LABELS[id];
  }
}

export function playerCatalogResizeMin(id: PlayerCatalogColumnId): number {
  if (id === "file") return headerMinPx("Datei");
  if (id === "ingestAt") return Math.max(headerMinPx("Ingest Datum"), 124);
  if (id === "duration") return headerMinPx("Dauer");
  if (id === "add") return 88;
  return TAG_COLUMN_MIN_WIDTHS[id] ?? 28;
}

export function sanitizePlayerCatalogWidths(
  widths: Record<PlayerCatalogColumnId, number>
): Record<PlayerCatalogColumnId, number> {
  const o = { ...widths };
  for (const id of PLAYER_CATALOG_ALL_COLUMN_IDS) {
    o[id] = Math.min(
      TABLE_COL_WIDTH_MAX,
      Math.max(playerCatalogResizeMin(id), o[id] ?? playerCatalogResizeMin(id))
    );
  }
  return o;
}

export function defaultPlayerCatalogWidths(): Record<PlayerCatalogColumnId, number> {
  const o = {} as Record<PlayerCatalogColumnId, number>;
  o.file = Math.max(defaultWidthFromMin(playerCatalogResizeMin("file")), 360);
  o.ingestAt = Math.max(defaultWidthFromMin(playerCatalogResizeMin("ingestAt")), 132);
  o.duration = Math.max(defaultWidthFromMin(playerCatalogResizeMin("duration")), 58);
  o.add = 96;
  for (const k of AUDIO_TAG_TABLE_COLUMN_KEYS) {
    o[k] = defaultWidthFromMin(playerCatalogResizeMin(k));
  }
  return o;
}

function mergeVisibleOrderIntoFull(
  fullOrder: PlayerCatalogColumnId[],
  hidden: Set<PlayerCatalogColumnId>,
  visPrime: PlayerCatalogColumnId[]
): PlayerCatalogColumnId[] {
  const iter = [...visPrime];
  return fullOrder.map((id) => (hidden.has(id) ? id : iter.shift()!));
}

export function reorderPlayerCatalogColumns(
  fullOrder: PlayerCatalogColumnId[],
  hidden: Set<PlayerCatalogColumnId>,
  fromId: PlayerCatalogColumnId,
  toId: PlayerCatalogColumnId
): PlayerCatalogColumnId[] {
  if (fromId === toId || fromId === "add" || toId === "add") return fullOrder;
  const vis = fullOrder.filter((id) => !hidden.has(id) && id !== "add");
  const from = vis.indexOf(fromId);
  const to = vis.indexOf(toId);
  if (from < 0 || to < 0) return fullOrder;
  const next = [...vis];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  const merged = mergeVisibleOrderIntoFull(
    fullOrder.filter((id) => id !== "add"),
    hidden,
    next
  );
  return ["add", ...merged];
}

export type PlayerCatalogTableLayout = {
  order: PlayerCatalogColumnId[];
  hidden: Set<PlayerCatalogColumnId>;
  widths: Record<PlayerCatalogColumnId, number>;
};

function isValidOrder(order: unknown): order is PlayerCatalogColumnId[] {
  if (!Array.isArray(order) || order.length !== PLAYER_CATALOG_ALL_COLUMN_IDS.length) return false;
  const s = new Set(order);
  if (s.size !== PLAYER_CATALOG_ALL_COLUMN_IDS.length) return false;
  return PLAYER_CATALOG_ALL_COLUMN_IDS.every((id) => s.has(id));
}

export function loadPlayerCatalogTableLayout(): PlayerCatalogTableLayout {
  const defaults: PlayerCatalogTableLayout = {
    order: [...PLAYER_CATALOG_ALL_COLUMN_IDS],
    hidden: new Set(),
    widths: defaultPlayerCatalogWidths(),
  };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as { order?: unknown; hidden?: unknown; widths?: unknown };
    const order = isValidOrder(parsed.order) ? pinAddFirst(parsed.order) : defaults.order;
    const hidden = new Set<PlayerCatalogColumnId>();
    if (Array.isArray(parsed.hidden)) {
      for (const h of parsed.hidden) {
        if (typeof h === "string" && PLAYER_CATALOG_FILTER_IDS.includes(h as PlayerCatalogColumnId)) {
          hidden.add(h as PlayerCatalogColumnId);
        }
      }
    }
    const widths = { ...defaults.widths };
    if (parsed.widths && typeof parsed.widths === "object") {
      for (const id of PLAYER_CATALOG_ALL_COLUMN_IDS) {
        const w = (parsed.widths as Record<string, unknown>)[id];
        if (typeof w === "number" && w >= 28 && w <= TABLE_COL_WIDTH_MAX) widths[id] = w;
      }
    }
    if (PLAYER_CATALOG_FILTER_IDS.every((id) => hidden.has(id))) return defaults;
    return { order, hidden, widths: sanitizePlayerCatalogWidths(widths) };
  } catch {
    return defaults;
  }
}

function pinAddFirst(order: PlayerCatalogColumnId[]): PlayerCatalogColumnId[] {
  return ["add", ...order.filter((id) => id !== "add")];
}

export function savePlayerCatalogTableLayout(state: PlayerCatalogTableLayout): void {
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

export function emptyPlayerCatalogFilters(): Record<PlayerCatalogColumnId, string> {
  const o = {} as Record<PlayerCatalogColumnId, string>;
  for (const id of PLAYER_CATALOG_ALL_COLUMN_IDS) o[id] = "";
  return o;
}
