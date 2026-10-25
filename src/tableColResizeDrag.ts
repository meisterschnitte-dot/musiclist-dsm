import { TABLE_COL_WIDTH_MAX } from "./tableColumnLayout";

/**
 * Spaltenbreite per Maus: während des Zugs nur <col>-Styles setzen (kein React-Re-Render pro Pixel).
 * Beim Loslassen einmal `onCommit` — wichtig bei sehr langen Tabellen (z. B. GVL).
 */
export function startColumnResizeDrag(options: {
  colIndex: number;
  clientX: number;
  startWidths: number[];
  minForIndex: (i: number) => number;
  /** Optional upper bound per column (e.g. schmale #/TC-Spalten). */
  maxForIndex?: (i: number) => number;
  /**
   * Letzte Spalte `width: auto` + `min-width` in px — nimmt Restbreite der Tabelle,
   * statt dass überschüssiger Platz (table-layout:fixed, width:100%) oft die erste Spalte aufbläht.
   */
  lastColumnAuto?: boolean;
  getColElements: () => HTMLCollection | HTMLTableColElement[] | null | undefined;
  onCommit: (nextWidths: number[]) => void;
}): void {
  const {
    colIndex,
    clientX: startX,
    startWidths,
    minForIndex,
    maxForIndex,
    lastColumnAuto,
    getColElements,
    onCommit,
  } = options;
  const startW = startWidths[colIndex];
  const current = [...startWidths];
  document.body.style.userSelect = "none";

  const applyWidthsToDom = () => {
    const cols = getColElements();
    if (!cols) return;
    const n = cols.length;
    const last = n - 1;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const w = current[i] ?? 0;
      sum += w;
      const el = cols[i] as HTMLTableColElement;
      if (!el?.style) continue;
      if (lastColumnAuto && i === last) {
        el.style.width = "auto";
        el.style.minWidth = `${w}px`;
      } else {
        el.style.width = `${w}px`;
        el.style.minWidth = lastColumnAuto ? "0" : `${w}px`;
      }
    }
    if (!lastColumnAuto) {
      const table = (cols[0] as HTMLElement | undefined)?.closest?.("table");
      if (table) {
        table.style.width = `${sum}px`;
        table.style.minWidth = `${sum}px`;
      }
    }
  };

  const onMove = (ev: MouseEvent) => {
    const minW = minForIndex(colIndex);
    const maxW = maxForIndex ? maxForIndex(colIndex) : TABLE_COL_WIDTH_MAX;
    const w = Math.min(maxW, Math.max(minW, startW + ev.clientX - startX));
    current[colIndex] = w;
    applyWidthsToDom();
  };

  const onUp = () => {
    document.body.style.userSelect = "";
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    onCommit([...current]);
  };

  applyWidthsToDom();
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

/**
 * Ziehgriff zwischen zwei Nachbarspalten: die eine wächst, die andere schrumpft
 * um denselben Betrag (Summe bleibt gleich).
 */
export function startAdjacentColumnResizeDrag(options: {
  leftIndex: number;
  clientX: number;
  startWidths: number[];
  minForIndex: (i: number) => number;
  getColElements: () => HTMLCollection | HTMLTableColElement[] | null | undefined;
  onCommit: (nextWidths: number[]) => void;
}): void {
  const { leftIndex, clientX: startX, startWidths, minForIndex, getColElements, onCommit } = options;
  const rightIndex = leftIndex + 1;
  if (rightIndex >= startWidths.length) return;
  const minL = minForIndex(leftIndex);
  const minR = minForIndex(rightIndex);
  const pair = startWidths[leftIndex]! + startWidths[rightIndex]!;
  const startL = startWidths[leftIndex]!;
  const current = [...startWidths];
  document.body.style.userSelect = "none";

  const applyWidthsToDom = () => {
    const cols = getColElements();
    if (!cols) return;
    for (let i = 0; i < cols.length; i++) {
      const el = cols[i] as HTMLTableColElement;
      if (!el?.style) continue;
      el.style.width = `${current[i]}px`;
      el.style.minWidth = "0";
    }
  };

  const onMove = (ev: MouseEvent) => {
    const maxL = Math.max(minL, pair - minR);
    const nextL = Math.min(maxL, Math.max(minL, startL + ev.clientX - startX));
    current[leftIndex] = nextL;
    current[rightIndex] = pair - nextL;
    applyWidthsToDom();
  };

  const onUp = () => {
    document.body.style.userSelect = "";
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    onCommit([...current]);
  };

  applyWidthsToDom();
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}
