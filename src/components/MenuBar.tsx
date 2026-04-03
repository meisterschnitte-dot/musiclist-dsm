import { useCallback, useEffect, useRef, useState } from "react";

type MenuId = "verwaltung" | "benutzer" | null;

type MenuBarProps = {
  brand: string;
  /** Eingeloggter Benutzer (Anzeigename). */
  sessionUserName: string;
  isAdmin: boolean;
  onLogout: () => void;
  onOpenUserManagement: () => void;
  onOpenStoragePaths: () => void;
  onSystemSettings: () => void;
  /** Kurze Erfolgshinweise; optional in der Leiste rechts */
  infoMessage?: string | null;
};

export function MenuBar({
  brand,
  sessionUserName,
  isAdmin,
  onLogout,
  onOpenUserManagement,
  onOpenStoragePaths,
  onSystemSettings,
  infoMessage,
}: MenuBarProps) {
  const [open, setOpen] = useState<MenuId>(null);
  const barRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (barRef.current?.contains(e.target as Node)) return;
      setOpen(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const toggle = useCallback((id: Exclude<MenuId, null>) => {
    setOpen((o: MenuId) => (o === id ? null : id));
  }, []);

  return (
    <nav ref={barRef} className="menubar" aria-label="Hauptmenü">
      <span className="menubar-brand">{brand}</span>
      <div className="menubar-menus">
        {isAdmin ? (
          <div className="menu">
            <button
              type="button"
              className="menu-trigger"
              aria-expanded={open === "verwaltung"}
              aria-haspopup="true"
              onClick={() => toggle("verwaltung")}
            >
              Verwaltung
            </button>
            {open === "verwaltung" && (
              <div className="menu-dropdown" role="menu">
                <button
                  type="button"
                  className="menu-item"
                  role="menuitem"
                  onClick={() => {
                    setOpen(null);
                    onOpenStoragePaths();
                  }}
                >
                  Speicherpfade
                </button>
                <button
                  type="button"
                  className="menu-item"
                  role="menuitem"
                  onClick={() => {
                    setOpen(null);
                    onSystemSettings();
                  }}
                >
                  GVL-Daten
                </button>
                <button
                  type="button"
                  className="menu-item"
                  role="menuitem"
                  onClick={() => {
                    setOpen(null);
                    onOpenUserManagement();
                  }}
                >
                  Benutzer verwalten
                </button>
              </div>
            )}
          </div>
        ) : null}
        <div className="menu">
          <button
            type="button"
            className="menu-trigger"
            aria-expanded={open === "benutzer"}
            aria-haspopup="true"
            onClick={() => toggle("benutzer")}
          >
            Benutzer
          </button>
          {open === "benutzer" && (
            <div className="menu-dropdown menu-dropdown--user" role="menu">
              <div className="menu-item-static" role="none">
                Angemeldet als <strong>{sessionUserName}</strong>
                {!isAdmin ? " (Benutzer)" : " (Administrator)"}
              </div>
              <button
                type="button"
                className="menu-item menu-item--border"
                role="menuitem"
                onClick={() => {
                  setOpen(null);
                  onLogout();
                }}
              >
                Abmelden
              </button>
            </div>
          )}
        </div>
      </div>
      {infoMessage ? (
        <span className="menubar-info" role="status" aria-live="polite">
          {infoMessage}
        </span>
      ) : null}
    </nav>
  );
}
