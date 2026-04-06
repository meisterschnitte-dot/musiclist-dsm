import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { replaceFolderPathPrefix } from "../edl/libraryPathUtils";
import type {
  EdlDirEntry,
  EdlLibraryAccess,
  OpenLibraryFilePayload,
} from "../edl/edlLibraryAccess";
import { isPlaylistLibraryFileName } from "../edl/playlistLibraryFile";
import { isGemaXlsFileName } from "../gema/parseGemaXls";

function pathKey(segments: string[]): string {
  return JSON.stringify(segments);
}

function pathSegmentsEqual(a: string[] | null, b: string[]): boolean {
  if (a === null || a.length !== b.length) return false;
  return a.every((s, i) => s === b[i]);
}

type ContextMenuState = {
  x: number;
  y: number;
  kind: "file" | "directory";
  parentSegments: string[];
  name: string;
};

type DragMovePayload = { parentSegments: string[]; fileName: string };

export type LibraryDeleteInfo =
  | { kind: "file"; parentSegments: string[]; fileName: string }
  | { kind: "directory"; pathSegments: string[] };

function toLibraryDeleteInfo(m: ContextMenuState): LibraryDeleteInfo {
  if (m.kind === "directory") {
    return { kind: "directory", pathSegments: [...m.parentSegments, m.name] };
  }
  return { kind: "file", parentSegments: m.parentSegments, fileName: m.name };
}

type Props = {
  library: EdlLibraryAccess | null;
  refreshKey: number;
  onOpenLibraryFile: (payload: OpenLibraryFilePayload) => void | Promise<void>;
  onLibraryChange?: () => void;
  /** Wenn true: zweite Rückfrage, weil die linke Titelübersicht betroffen wäre. */
  deleteClearsPlaylist?: (info: LibraryDeleteInfo) => boolean;
  onLibraryEntryDeleted?: (info: LibraryDeleteInfo) => void;
  /** `null` = Import in die Wurzel; sonst Zielordner relativ zur EDL-Wurzel. */
  importTargetSegments: string[] | null;
  onImportTargetChange: (segments: string[] | null) => void;
  /** Blendet die gesamte EDL- & Playlist Browser-Spalte aus (Steuerung über Hamburger-Menü). */
  onCollapseAblagePanel?: () => void;
  /** Öffnet die Dateiauswahl für EDL/Playlist (verstecktes File-Input in der App). */
  onImportEdl: () => void;
  importEdlTitle: string;
  importEdlDisabled?: boolean;
  /** Separater Import nur für GEMA-XLS (zweites File-Input in der App). */
  onImportGemaXls: () => void;
  importGemaXlsTitle: string;
  importGemaXlsDisabled?: boolean;
  /** Nach Umbenennen eines Ordners: Import-Ziel und geöffnete Datei anpassen. */
  onEdlFolderRenamed?: (
    parentSegments: string[],
    oldFolderName: string,
    newFolderName: string
  ) => void;
  /** Datei, die aktuell aus dem Browser in der Playlist geöffnet ist — bleibt markiert bis zur nächsten Browser-/Import-Aktion. */
  activeLibraryFile?: { parentSegments: string[]; fileName: string } | null;
  /** Nur lesen: keine Importe, kein Löschen, kein Verschieben (Kundenkonten). */
  readOnly?: boolean;
};

export function EdlLibraryPanel({
  library,
  refreshKey,
  onOpenLibraryFile,
  onLibraryChange,
  deleteClearsPlaylist,
  onLibraryEntryDeleted,
  importTargetSegments,
  onImportTargetChange,
  onCollapseAblagePanel,
  onImportEdl,
  importEdlTitle,
  importEdlDisabled = false,
  onImportGemaXls,
  importGemaXlsTitle,
  importGemaXlsDisabled = false,
  onEdlFolderRenamed,
  activeLibraryFile = null,
  readOnly = false,
}: Props) {
  const [cache, setCache] = useState<Record<string, EdlDirEntry[] | undefined>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [listErr, setListErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dropHighlight, setDropHighlight] = useState<string | null>(null);
  const [draggingFile, setDraggingFile] = useState(false);
  const dragPayloadRef = useRef<DragMovePayload | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const newFolderInputRef = useRef<HTMLInputElement>(null);
  const [renameFolderCtx, setRenameFolderCtx] = useState<{
    parentSegments: string[];
    oldName: string;
  } | null>(null);
  const [renameFolderNewName, setRenameFolderNewName] = useState("");
  const renameFolderInputRef = useRef<HTMLInputElement>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [archiveMenuOpen, setArchiveMenuOpen] = useState(false);
  const archiveCompactRef = useRef<HTMLDivElement>(null);

  const reloadCaches = useCallback(async (interactive = false) => {
    if (!library) {
      setCache({});
      return;
    }
    setListErr(null);
    try {
      if (interactive) {
        const ok = (await library.ensureWritableInteractive?.()) ?? true;
        if (!ok) {
          setListErr("Kein Zugriff auf die EDL-Bibliothek.");
          setCache({});
          return;
        }
      }
      const paths: string[][] = [[]];
      for (const key of expanded) {
        try {
          paths.push(JSON.parse(key) as string[]);
        } catch {
          /* ignore */
        }
      }
      const next: Record<string, EdlDirEntry[]> = {};
      for (const segments of paths) {
        next[pathKey(segments)] = await library.list(segments);
      }
      setCache(next);
    } catch (e) {
      setCache({});
      if (interactive) {
        setListErr(e instanceof Error ? e.message : "Ordner konnte nicht gelesen werden.");
      }
    }
  }, [library, expanded]);

  useEffect(() => {
    void reloadCaches();
  }, [reloadCaches, refreshKey]);

  /** Aktive Datei sichtbar: alle übergeordneten Ordner aufklappen. */
  useEffect(() => {
    if (!activeLibraryFile || !library) return;
    const segs = activeLibraryFile.parentSegments;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (let i = 0; i < segs.length; i++) {
        next.add(pathKey(segs.slice(0, i + 1)));
      }
      return next;
    });
  }, [activeLibraryFile, library]);

  useEffect(() => {
    if (!newFolderOpen) return;
    const id = requestAnimationFrame(() => {
      newFolderInputRef.current?.focus();
      newFolderInputRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [newFolderOpen]);

  useEffect(() => {
    if (!newFolderOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setNewFolderOpen(false);
        setNewFolderName("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newFolderOpen]);

  useEffect(() => {
    if (!contextMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [contextMenu]);

  useEffect(() => {
    if (!archiveMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (archiveCompactRef.current?.contains(e.target as Node)) return;
      setArchiveMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [archiveMenuOpen]);

  useEffect(() => {
    if (!archiveMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setArchiveMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [archiveMenuOpen]);

  const openContextMenu = useCallback(
    (e: MouseEvent, kind: "file" | "directory", parentSegments: string[], name: string) => {
      if (readOnly && kind === "directory") return;
      e.preventDefault();
      e.stopPropagation();
      const pad = 8;
      const mw = 200;
      const mh = 44;
      let x = e.clientX;
      let y = e.clientY;
      if (x + mw > window.innerWidth - pad) x = Math.max(pad, window.innerWidth - mw - pad);
      if (y + mh > window.innerHeight - pad) y = Math.max(pad, window.innerHeight - mh - pad);
      setContextMenu({ x, y, kind, parentSegments, name });
    },
    [readOnly]
  );

  const runDeleteFromContext = useCallback(
    (m: ContextMenuState) => {
      if (!library) return;
      const label =
        m.kind === "directory" ? `Ordner „${m.name}“ inkl. Inhalt` : `Datei „${m.name}“`;
      setContextMenu(null);
      const confirmText =
        readOnly && m.kind === "file"
          ? `${label} aus Ihrer Kundenansicht ausblenden?`
          : `${label} wirklich löschen?`;
      if (!window.confirm(confirmText)) return;
      const deleteInfo = toLibraryDeleteInfo(m);
      if (
        deleteClearsPlaylist?.(deleteInfo) &&
        !window.confirm(
          "Die geöffnete Liste ist in der Titelübersicht aktiv. Beim Löschen wird sie geleert. Wirklich fortfahren?"
        )
      ) {
        return;
      }
      void (async () => {
        setBusy(true);
        setListErr(null);
        try {
          if (m.kind === "file") {
            await library.deleteFile(m.parentSegments, m.name);
          } else {
            await library.deleteDirectory([...m.parentSegments, m.name]);
            const deletedPath = [...m.parentSegments, m.name];
            setExpanded((prev) => {
              const next = new Set(prev);
              for (const k of prev) {
                try {
                  const segs = JSON.parse(k) as string[];
                  if (
                    segs.length >= deletedPath.length &&
                    deletedPath.every((s, i) => s === segs[i])
                  ) {
                    next.delete(k);
                  }
                } catch {
                  /* ignore */
                }
              }
              return next;
            });
          }
          onLibraryEntryDeleted?.(deleteInfo);
          onLibraryChange?.();
        } catch (e) {
          setListErr(e instanceof Error ? e.message : "Löschen fehlgeschlagen.");
        } finally {
          setBusy(false);
        }
      })();
    },
    [library, onLibraryChange, deleteClearsPlaylist, onLibraryEntryDeleted, readOnly]
  );

  const toggleFolder = useCallback((segments: string[]) => {
    const key = pathKey(segments);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const openNewFolderModal = useCallback(() => {
    if (!library) return;
    setNewFolderName("");
    setNewFolderOpen(true);
  }, [library]);

  const submitNewFolder = useCallback(async () => {
    if (!library) return;
    const name = newFolderName.trim();
    if (!name) return;
    setBusy(true);
    setListErr(null);
    try {
      await library.mkdir([], name);
      setNewFolderOpen(false);
      setNewFolderName("");
      onLibraryChange?.();
    } catch (e) {
      setListErr(e instanceof Error ? e.message : "Ordner konnte nicht angelegt werden.");
    } finally {
      setBusy(false);
    }
  }, [library, newFolderName, onLibraryChange]);

  useEffect(() => {
    if (!renameFolderCtx) return;
    const id = requestAnimationFrame(() => {
      renameFolderInputRef.current?.focus();
      renameFolderInputRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [renameFolderCtx]);

  useEffect(() => {
    if (!renameFolderCtx) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setRenameFolderCtx(null);
        setRenameFolderNewName("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [renameFolderCtx]);

  const submitRenameFolder = useCallback(async () => {
    if (!library || !renameFolderCtx) return;
    const { parentSegments, oldName } = renameFolderCtx;
    const name = renameFolderNewName.trim().replace(/[/\\]/g, "");
    if (!name) {
      setListErr("Bitte einen Ordnernamen eingeben.");
      return;
    }
    if (name === oldName) {
      setRenameFolderCtx(null);
      setRenameFolderNewName("");
      return;
    }
    setBusy(true);
    setListErr(null);
    try {
      await library.renameDirectory(parentSegments, oldName, name);
      const oldPath = [...parentSegments, oldName];
      const newPath = [...parentSegments, name];
      setExpanded((prev) => {
        const next = new Set<string>();
        for (const k of prev) {
          try {
            const segs = JSON.parse(k) as string[];
            next.add(JSON.stringify(replaceFolderPathPrefix(segs, oldPath, newPath)));
          } catch {
            next.add(k);
          }
        }
        return next;
      });
      onEdlFolderRenamed?.(parentSegments, oldName, name);
      setRenameFolderCtx(null);
      setRenameFolderNewName("");
      onLibraryChange?.();
    } catch (e) {
      setListErr(e instanceof Error ? e.message : "Umbenennen fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }, [library, renameFolderCtx, renameFolderNewName, onEdlFolderRenamed, onLibraryChange]);

  const handleFileDragStart = useCallback(
    (parentSegments: string[], fileName: string) => (e: DragEvent) => {
      if (!library || busy) {
        e.preventDefault();
        return;
      }
      e.stopPropagation();
      dragPayloadRef.current = { parentSegments, fileName };
      e.dataTransfer.setData("application/x-edl-library-file", fileName);
      e.dataTransfer.effectAllowed = "move";
      setDraggingFile(true);
    },
    [library, busy]
  );

  const handleFileDragEnd = useCallback(() => {
    dragPayloadRef.current = null;
    setDraggingFile(false);
    setDropHighlight(null);
  }, []);

  const runMove = useCallback(
    async (toSegments: string[], payload: DragMovePayload) => {
      if (!library) return;
      setBusy(true);
      setListErr(null);
      try {
        await library.moveFile(payload.parentSegments, payload.fileName, toSegments);
        onLibraryChange?.();
      } catch (e) {
        setListErr(e instanceof Error ? e.message : "Verschieben fehlgeschlagen.");
      } finally {
        setBusy(false);
      }
    },
    [library, onLibraryChange]
  );

  const handleDropOnFolder = useCallback(
    (destSegments: string[]) => async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      /** Sofort sichern: vor await feuert oft dragend und leert das Ref. */
      const payload = dragPayloadRef.current;
      setDropHighlight(null);
      if (!library || !payload) return;
      try {
        await runMove(destSegments, payload);
      } catch (err) {
        setListErr(err instanceof Error ? err.message : "Ordner nicht erreichbar.");
      }
    },
    [library, runMove]
  );

  const handleDropOnRoot = useCallback(
    async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const payload = dragPayloadRef.current;
      setDropHighlight(null);
      if (!library || !payload) return;
      await runMove([], payload);
    },
    [library, runMove]
  );

  const folderDragEnter = useCallback((destKey: string) => {
    setDropHighlight(destKey);
  }, []);

  const folderDragLeave = useCallback((e: DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDropHighlight(null);
    }
  }, []);

  const rootDragEnter = useCallback(() => {
    setDropHighlight("__root__");
  }, []);

  const rootDragLeave = useCallback((e: DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDropHighlight(null);
    }
  }, []);

  const openFile = useCallback(
    async (parentSegments: string[], name: string) => {
      if (!library) return;
      try {
        if (isGemaXlsFileName(name)) {
          const arrayBuffer = await library.readBinary(parentSegments, name);
          await Promise.resolve(
            onOpenLibraryFile({ parentSegments, fileName: name, arrayBuffer })
          );
        } else {
          const text = await library.readText(parentSegments, name);
          await Promise.resolve(onOpenLibraryFile({ parentSegments, fileName: name, text }));
        }
      } catch (e) {
        setListErr(e instanceof Error ? e.message : "Datei konnte nicht geöffnet werden.");
      }
    },
    [library, onOpenLibraryFile]
  );

  const rootEntries = library ? cache[pathKey([])] : undefined;

  const renderTree = (parentSegments: string[]): ReactNode => {
    if (!library) return null;
    const key = pathKey(parentSegments);
    const entries = cache[key];
    if (entries === undefined) {
      return (
        <li className="edl-tree-loading">
          <span className="edl-tree-loading-text">Laden …</span>
        </li>
      );
    }
    if (entries.length === 0) {
      return (
        <li className="edl-tree-empty-msg">Keine EDL-, XLS- oder Playlist-Dateien in diesem Ordner.</li>
      );
    }
    return entries.map((row) => {
      if (row.kind === "directory") {
        const childSegments = [...parentSegments, row.name];
        const cKey = pathKey(childSegments);
        const isOpen = expanded.has(cKey);
        const folderDropKey = cKey;
        const isImportTarget = pathSegmentsEqual(importTargetSegments, childSegments);
        const folderLabel = row.label ?? row.name;
        if (readOnly) {
          return (
            <li key={`dir:${cKey}`} className="edl-tree-node">
              <div className="edl-tree-line edl-tree-line--folder">
                <button
                  type="button"
                  className="edl-tree-twisty"
                  aria-expanded={isOpen}
                  aria-label={isOpen ? "Ordner zuklappen" : "Ordner aufklappen"}
                  disabled={busy}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    toggleFolder(childSegments);
                  }}
                >
                  {isOpen ? "▼" : "▶"}
                </button>
                <span className="edl-tree-folder-name edl-tree-folder-name--readonly">{folderLabel}</span>
              </div>
              {isOpen && <ul className="edl-tree-nested">{renderTree(childSegments)}</ul>}
            </li>
          );
        }
        return (
          <li key={`dir:${cKey}`} className="edl-tree-node">
            <div
              className="edl-tree-line edl-tree-line--folder"
              onContextMenu={(e) => openContextMenu(e, "directory", parentSegments, row.name)}
            >
              <button
                type="button"
                className="edl-tree-twisty"
                aria-expanded={isOpen}
                aria-label={isOpen ? "Ordner zuklappen" : "Ordner aufklappen"}
                disabled={busy}
                onClick={(ev) => {
                  ev.stopPropagation();
                  toggleFolder(childSegments);
                }}
              >
                {isOpen ? "▼" : "▶"}
              </button>
              <span
                role="button"
                tabIndex={busy ? -1 : 0}
                aria-pressed={isImportTarget}
                className={
                  "edl-tree-folder-name" +
                  (dropHighlight === folderDropKey ? " edl-tree-folder-name--drop-over" : "") +
                  (isImportTarget ? " edl-tree-folder-name--import-target" : "")
                }
                title="Klick: Import-Ziel wählen oder aufheben · Ziehen: EDL hierher verschieben"
                onClick={(ev) => {
                  ev.preventDefault();
                  ev.stopPropagation();
                  if (busy) return;
                  if (pathSegmentsEqual(importTargetSegments, childSegments)) {
                    onImportTargetChange(null);
                  } else {
                    onImportTargetChange(childSegments);
                  }
                }}
                onKeyDown={(ev) => {
                  if (busy) return;
                  if (ev.key === "Enter" || ev.key === " ") {
                    ev.preventDefault();
                    if (pathSegmentsEqual(importTargetSegments, childSegments)) {
                      onImportTargetChange(null);
                    } else {
                      onImportTargetChange(childSegments);
                    }
                  }
                }}
                onDragOver={(ev) => {
                  ev.preventDefault();
                  ev.stopPropagation();
                  ev.dataTransfer.dropEffect = "move";
                }}
                onDragEnter={(ev) => {
                  ev.preventDefault();
                  folderDragEnter(folderDropKey);
                }}
                onDragLeave={folderDragLeave}
                onDrop={(ev) => void handleDropOnFolder(childSegments)(ev)}
              >
                {row.name}
              </span>
            </div>
            {isOpen && <ul className="edl-tree-nested">{renderTree(childSegments)}</ul>}
          </li>
        );
      }
      const isPlaylistFile = isPlaylistLibraryFileName(row.name);
      const isGemaXlsFile = isGemaXlsFileName(row.name);
      const isActive =
        activeLibraryFile != null &&
        activeLibraryFile.fileName === row.name &&
        pathSegmentsEqual(activeLibraryFile.parentSegments, parentSegments);
      const fileLabel = row.label ?? row.name;
      return (
        <li key={`file:${key}:${row.name}`} className="edl-tree-node">
          <div
            className="edl-tree-line edl-tree-line--file"
            onContextMenu={
              (e) => openContextMenu(e, "file", parentSegments, row.name)
            }
          >
            <span className="edl-tree-twisty-spacer" aria-hidden />
            <div
              className="edl-tree-file-wrap"
              draggable={readOnly ? false : !busy}
              onDragStart={readOnly ? undefined : handleFileDragStart(parentSegments, row.name)}
              onDragEnd={readOnly ? undefined : handleFileDragEnd}
              title={
                readOnly
                  ? isPlaylistFile
                    ? "Doppelklick: Playlist laden"
                    : isGemaXlsFile
                      ? "Doppelklick: GEMA-Liste (XLS) laden"
                      : "Doppelklick: EDL laden"
                  : isPlaylistFile
                    ? "Zum Verschieben ziehen · Doppelklick: gespeicherte Playlist laden"
                    : isGemaXlsFile
                      ? "Zum Verschieben ziehen · Doppelklick: GEMA-Liste (XLS) laden"
                      : "Zum Verschieben ziehen · Doppelklick: EDL laden"
              }
            >
              <div
                role="button"
                tabIndex={busy ? -1 : 0}
                aria-disabled={busy}
                aria-current={isActive ? "true" : undefined}
                className={
                  "edl-library-file-open" + (isActive ? " edl-library-file-open--active" : "")
                }
                onDoubleClick={() => {
                  if (busy) return;
                  void openFile(parentSegments, row.name);
                }}
                onKeyDown={(ev) => {
                  if (busy) return;
                  if (ev.key === "Enter" || ev.key === " ") {
                    ev.preventDefault();
                    void openFile(parentSegments, row.name);
                  }
                }}
                title={
                  (isPlaylistFile
                    ? "Gespeicherte Playlist laden"
                    : isGemaXlsFile
                      ? "GEMA-Liste (XLS) laden"
                      : "EDL laden") + " (Doppelklick)"
                }
              >
                <span
                  className={
                    "edl-library-ico " +
                    (isPlaylistFile
                      ? "edl-library-ico--playlist"
                      : isGemaXlsFile
                        ? "edl-library-ico--xls"
                        : "edl-library-ico--file")
                  }
                  aria-hidden
                />
                {fileLabel}
              </div>
            </div>
          </div>
        </li>
      );
    });
  };

  return (
    <>
      <div className="panel-head panel-head--edl-archive">
        <div className="panel-head-row panel-head-row--edl-archive">
          <h2 className="panel-title">
            {readOnly ? "Playlist-Browser (freigegeben)" : "EDL- & Playlist Browser"}
          </h2>
          <div className="edl-archive-actions">
            <div className="edl-archive-actions-inline">
              {!readOnly && (
                <>
                  <button
                    type="button"
                    className="btn-cell"
                    onClick={() => {
                      if (importEdlDisabled) return;
                      onImportEdl();
                    }}
                    disabled={importEdlDisabled}
                    title={importEdlTitle}
                  >
                    Import EDL
                  </button>
                  <button
                    type="button"
                    className="btn-cell"
                    onClick={() => {
                      if (importGemaXlsDisabled) return;
                      onImportGemaXls();
                    }}
                    disabled={importGemaXlsDisabled}
                    title={importGemaXlsTitle}
                  >
                    Import XLS
                  </button>
                </>
              )}
              <button
                type="button"
                className="btn-cell"
                onClick={() => void reloadCaches(true)}
                disabled={busy || !library}
                title="Liste neu laden"
              >
                Aktualisieren
              </button>
              {!readOnly && (
                <>
                  <button
                    type="button"
                    className="btn-cell"
                    onClick={openNewFolderModal}
                    disabled={!library || busy}
                  >
                    Neuer Ordner
                  </button>
                </>
              )}
              {onCollapseAblagePanel && (
                <button
                  type="button"
                  className="btn-edl-panel-collapse"
                  onClick={onCollapseAblagePanel}
                  title="EDL- & Playlist Browser einklappen — mehr Platz für EDL- & Playlist"
                  aria-label="EDL- & Playlist Browser einklappen — mehr Platz für EDL- & Playlist"
                >
                  <span className="btn-edl-panel-collapse-arrow" aria-hidden>
                    ›
                  </span>
                </button>
              )}
            </div>
            <div className="edl-archive-actions-compact" ref={archiveCompactRef}>
              <button
                type="button"
                className="edl-archive-burger"
                aria-haspopup="menu"
                aria-expanded={archiveMenuOpen}
                aria-label="Aktionen zum EDL- & Playlist Browser"
                title="Menü"
                onClick={() => setArchiveMenuOpen((o) => !o)}
              >
                <span className="edl-archive-burger-icon" aria-hidden>
                  <span className="edl-archive-burger-line" />
                  <span className="edl-archive-burger-line" />
                  <span className="edl-archive-burger-line" />
                </span>
              </button>
              {archiveMenuOpen && (
                <div className="edl-archive-dropdown" role="menu">
                  {!readOnly && (
                    <>
                      <button
                        type="button"
                        className="edl-archive-dropdown-item"
                        role="menuitem"
                        title={importEdlTitle}
                        onClick={() => {
                          if (!importEdlDisabled) onImportEdl();
                          setArchiveMenuOpen(false);
                        }}
                        disabled={importEdlDisabled}
                      >
                        Import EDL
                      </button>
                      <button
                        type="button"
                        className="edl-archive-dropdown-item"
                        role="menuitem"
                        title={importGemaXlsTitle}
                        onClick={() => {
                          if (!importGemaXlsDisabled) onImportGemaXls();
                          setArchiveMenuOpen(false);
                        }}
                        disabled={importGemaXlsDisabled}
                      >
                        Import XLS
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="edl-archive-dropdown-item"
                    role="menuitem"
                    onClick={() => {
                      void reloadCaches(true);
                      setArchiveMenuOpen(false);
                    }}
                    disabled={busy || !library}
                  >
                    Aktualisieren
                  </button>
                  {!readOnly && (
                    <button
                      type="button"
                      className="edl-archive-dropdown-item"
                      role="menuitem"
                      onClick={() => {
                        openNewFolderModal();
                        setArchiveMenuOpen(false);
                      }}
                      disabled={!library || busy}
                    >
                      Neuer Ordner
                    </button>
                  )}
                  {onCollapseAblagePanel && (
                    <button
                      type="button"
                      className="edl-archive-dropdown-item edl-archive-dropdown-item--separator edl-archive-dropdown-item--collapse-icon"
                      role="menuitem"
                      onClick={() => {
                        onCollapseAblagePanel();
                        setArchiveMenuOpen(false);
                      }}
                      title="EDL- & Playlist Browser einklappen — mehr Platz für EDL- & Playlist"
                      aria-label="EDL- & Playlist Browser einklappen — mehr Platz für EDL- & Playlist"
                    >
                      <span aria-hidden>›</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="panel-body panel-body--edl-library">
        <div className="edl-library">
          {!library ? (
            <p className="edl-library-empty">
              <span className="edl-library-empty-hint">
                Melden Sie sich an, um Ihre persönliche EDL- und Playlist-Bibliothek auf dem Server zu
                nutzen. Ohne Anmeldung können Sie Dateien nur per Import in die aktuelle Liste laden.
              </span>
            </p>
          ) : (
            <>
              {readOnly ? (
                <div className="edl-library-root-readonly">
                  <span className="edl-library-root-drop-label" aria-hidden>
                    ⧉
                  </span>
                  <span>{library.label}</span>
                </div>
              ) : (
              <div
                role="button"
                tabIndex={busy ? -1 : 0}
                aria-pressed={importTargetSegments === null}
                className={
                  "edl-library-root-drop" +
                  (dropHighlight === "__root__" ? " edl-library-root-drop--over" : "") +
                  (importTargetSegments === null ? " edl-library-root-drop--import-target" : "")
                }
                title="Klick: Import-Ziel Wurzel · Ziehen: EDL in die oberste Ebene"
                onClick={(ev) => {
                  ev.preventDefault();
                  if (busy) return;
                  onImportTargetChange(null);
                }}
                onKeyDown={(ev) => {
                  if (busy) return;
                  if (ev.key === "Enter" || ev.key === " ") {
                    ev.preventDefault();
                    onImportTargetChange(null);
                  }
                }}
                onDragOver={(ev) => {
                  ev.preventDefault();
                  ev.stopPropagation();
                  ev.dataTransfer.dropEffect = "move";
                }}
                onDragEnter={(ev) => {
                  ev.preventDefault();
                  rootDragEnter();
                }}
                onDragLeave={rootDragLeave}
                onDrop={(ev) => void handleDropOnRoot(ev)}
              >
                <span className="edl-library-root-drop-label" aria-hidden>
                  ⧉
                </span>
                <span>Wurzel ({library.label})</span>
              </div>
              )}
              {listErr && <p className="edl-library-err">{listErr}</p>}
              <ul
                className={
                  "edl-tree edl-tree-root" + (draggingFile ? " edl-library-list--dragging" : "")
                }
              >
                {rootEntries === undefined ? (
                  <li className="edl-tree-loading">
                    <span className="edl-tree-loading-text">Laden …</span>
                  </li>
                ) : (
                  renderTree([])
                )}
              </ul>
            </>
          )}
        </div>
      </div>
      {contextMenu && (
        <>
          <div
            className="edl-ctx-backdrop"
            aria-hidden
            onMouseDown={() => setContextMenu(null)}
          />
          <div
            className="edl-ctx-menu"
            role="menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {contextMenu.kind === "directory" ? (
              <button
                type="button"
                className="edl-ctx-menu-item"
                role="menuitem"
                onClick={() => {
                  const m = contextMenu;
                  setContextMenu(null);
                  setRenameFolderCtx({
                    parentSegments: m.parentSegments,
                    oldName: m.name,
                  });
                  setRenameFolderNewName(m.name);
                }}
              >
                Umbenennen …
              </button>
            ) : null}
            <button
              type="button"
              className="edl-ctx-menu-item"
              role="menuitem"
              onClick={() => runDeleteFromContext(contextMenu)}
            >
              Löschen
            </button>
          </div>
        </>
      )}
      {newFolderOpen && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edl-new-folder-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setNewFolderOpen(false);
              setNewFolderName("");
            }
          }}
        >
          <div className="modal modal--new-folder" onMouseDown={(e) => e.stopPropagation()}>
            <h2 id="edl-new-folder-title" className="modal-title">
              Neuer Ordner
            </h2>
            <p className="modal-lead">Ordner wird in der Wurzel des EDL- & Playlist Browsers angelegt.</p>
            <form
              className="edl-new-folder-form"
              onSubmit={(e) => {
                e.preventDefault();
                void submitNewFolder();
              }}
            >
              <label className="tag-field">
                <span>Ordnername</span>
                <input
                  ref={newFolderInputRef}
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  autoComplete="off"
                  required
                />
              </label>
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-modal"
                  onClick={() => {
                    setNewFolderOpen(false);
                    setNewFolderName("");
                  }}
                >
                  Abbrechen
                </button>
                <button type="submit" className="btn-modal primary" disabled={busy}>
                  Anlegen
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {renameFolderCtx && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edl-rename-folder-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setRenameFolderCtx(null);
              setRenameFolderNewName("");
            }
          }}
        >
          <div className="modal modal--new-folder" onMouseDown={(e) => e.stopPropagation()}>
            <h2 id="edl-rename-folder-title" className="modal-title">
              Ordner umbenennen
            </h2>
            <p className="modal-lead">
              Ordner „{renameFolderCtx.oldName}“ — neuer Name relativ zum übergeordneten Ordner.
            </p>
            <form
              className="edl-new-folder-form"
              onSubmit={(e) => {
                e.preventDefault();
                void submitRenameFolder();
              }}
            >
              <label className="tag-field">
                <span>Neuer Ordnername</span>
                <input
                  ref={renameFolderInputRef}
                  type="text"
                  value={renameFolderNewName}
                  onChange={(e) => setRenameFolderNewName(e.target.value)}
                  autoComplete="off"
                  required
                />
              </label>
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-modal"
                  onClick={() => {
                    setRenameFolderCtx(null);
                    setRenameFolderNewName("");
                  }}
                >
                  Abbrechen
                </button>
                <button type="submit" className="btn-modal primary" disabled={busy}>
                  Umbenennen
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
