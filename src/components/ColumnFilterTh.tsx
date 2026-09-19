import { memo, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { DebouncedSearchInput } from "./DebouncedSearchInput";

export const ColumnFilterTh = memo(function ColumnFilterTh({
  colIndex,
  attachResize,
  className,
  title,
  label,
  filterValue,
  onFilterChange,
  onClearFilter,
  ariaLabelFilter,
  columnDrag,
  onHideColumn,
  hideColumnDisabled,
  columnSort,
}: {
  colIndex: number;
  attachResize: (colIndex: number) => (e: ReactMouseEvent) => void;
  className?: string;
  title?: string;
  label: ReactNode;
  filterValue: string;
  onFilterChange: (value: string) => void;
  onClearFilter: () => void;
  ariaLabelFilter: string;
  columnDrag?: {
    columnId: string;
    onDragStart: (e: ReactDragEvent) => void;
    onDragOver: (e: ReactDragEvent) => void;
    onDrop: (e: ReactDragEvent) => void;
    onDragEnd: (e: ReactDragEvent) => void;
  };
  onHideColumn?: () => void;
  hideColumnDisabled?: boolean;
  columnSort?: {
    activeDirection: "asc" | "desc" | null;
    onSortAsc: () => void;
    onSortDesc: () => void;
  };
}) {
  const hasFilter = filterValue.trim().length > 0;
  return (
    <th
      className={`table-th-resizable table-th-with-filter${className ? ` ${className}` : ""}${
        columnDrag ? " table-th-col-dnd" : ""
      }`}
      scope="col"
      title={title}
      onDragOver={
        columnDrag
          ? (e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              columnDrag.onDragOver(e);
            }
          : undefined
      }
      onDrop={columnDrag?.onDrop}
    >
      <div className="table-th-filter-stack">
        <div className="table-th-head-row">
          {columnDrag && (
            <span
              className="table-th-col-drag-handle"
              draggable
              onDragStart={columnDrag.onDragStart}
              onDragEnd={columnDrag.onDragEnd}
              title="Ziehen zum Umsortieren"
              aria-hidden
            >
              ⠿
            </span>
          )}
          <span className="table-th-text">{label}</span>
          {columnSort && (
            <span className="table-th-sort-btns" role="group" aria-label="Sortierung">
              <button
                type="button"
                className={`table-th-sort-btn${
                  columnSort.activeDirection === "asc" ? " table-th-sort-btn--active" : ""
                }`}
                title="Aufsteigend (A–Z)"
                aria-label="Aufsteigend sortieren"
                onClick={(e) => {
                  e.stopPropagation();
                  columnSort.onSortAsc();
                }}
              >
                ▲
              </button>
              <button
                type="button"
                className={`table-th-sort-btn${
                  columnSort.activeDirection === "desc" ? " table-th-sort-btn--active" : ""
                }`}
                title="Absteigend (Z–A)"
                aria-label="Absteigend sortieren"
                onClick={(e) => {
                  e.stopPropagation();
                  columnSort.onSortDesc();
                }}
              >
                ▼
              </button>
            </span>
          )}
          {onHideColumn && (
            <button
              type="button"
              className="table-th-col-hide"
              disabled={hideColumnDisabled}
              title={hideColumnDisabled ? "Mindestens eine Spalte muss sichtbar bleiben." : "Spalte ausblenden"}
              aria-label={`Spalte ${typeof label === "string" ? label : ""} ausblenden`}
              onClick={(e) => {
                e.stopPropagation();
                onHideColumn();
              }}
            >
              −
            </button>
          )}
          {hasFilter && (
            <button
              type="button"
              className="table-filter-clear-col"
              onClick={(e) => {
                e.stopPropagation();
                onClearFilter();
              }}
              aria-label="Filter dieser Spalte löschen"
              title="Filter löschen"
            >
              ×
            </button>
          )}
        </div>
        <DebouncedSearchInput
          type="search"
          className="table-col-filter-input"
          value={filterValue}
          onChange={onFilterChange}
          placeholder="Filter… Enter"
          title="Enter zum Filtern"
          aria-label={ariaLabelFilter}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
      <span
        className="table-col-resize-handle"
        onMouseDown={attachResize(colIndex)}
        role="separator"
        aria-orientation="vertical"
        aria-label="Spaltenbreite anpassen"
      />
    </th>
  );
});
