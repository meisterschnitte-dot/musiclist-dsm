import { useCallback, useEffect, useRef, useState } from "react";
import type { AppTheme } from "../storage/themeStorage";

type MenuId = "verwaltung" | "benutzer" | null;

type MenuBarProps = {
  brand: string;
  /** Eingeloggter Benutzer (Anzeigename). */
  sessionUserName: string;
  isAdmin: boolean;
  onLogout: () => void;
  onOpenUserManagement: () => void;
  onOpenStoragePaths: () => void;
  onOpenCustomers: () => void;
  /** Kundenansicht (Playlist wie Export) ein/aus — nur sinnvoll für Admins. */
  customerViewActive?: boolean;
  onToggleCustomerView?: () => void;
  /** Zurück zur Admin-Standardansicht (Kundenansicht aus). */
  onExitCustomerView?: () => void;
  onSystemSettings: () => void;
  /** Kurze Erfolgshinweise; optional in der Leiste rechts */
  infoMessage?: string | null;
  /** Schriftgröße (0.75–1.5), steuert `rem` über `--app-font-scale`. */
  fontScale: number;
  onFontScaleDec: () => void;
  onFontScaleInc: () => void;
  onFontScaleReset: () => void;
  fontScaleDecDisabled: boolean;
  fontScaleIncDisabled: boolean;
  theme: AppTheme;
  onThemeChange: (t: AppTheme) => void;
};

export function MenuBar({
  brand,
  sessionUserName,
  isAdmin,
  onLogout,
  onOpenUserManagement,
  onOpenStoragePaths,
  onOpenCustomers,
  customerViewActive = false,
  onToggleCustomerView,
  onExitCustomerView,
  onSystemSettings,
  infoMessage,
  fontScale,
  onFontScaleDec,
  onFontScaleInc,
  onFontScaleReset,
  fontScaleDecDisabled,
  fontScaleIncDisabled,
  theme,
  onThemeChange,
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
                  disabled={!customerViewActive}
                  title={
                    customerViewActive
                      ? "Admin-Ansicht mit EDL-Browser und Musikdatenbank"
                      : "Bereits Standardansicht aktiv"
                  }
                  onClick={() => {
                    if (!customerViewActive) return;
                    setOpen(null);
                    onExitCustomerView?.();
                  }}
                >
                  Standardansicht
                </button>
                <button
                  type="button"
                  className={
                    "menu-item" + (customerViewActive ? " menu-item--toggle-on" : "")
                  }
                  role="menuitem"
                  aria-pressed={customerViewActive}
                  onClick={() => {
                    setOpen(null);
                    onToggleCustomerView?.();
                  }}
                >
                  Kundenansicht
                </button>
                <button
                  type="button"
                  className="menu-item"
                  role="menuitem"
                  onClick={() => {
                    setOpen(null);
                    onOpenCustomers();
                  }}
                >
                  Kunden verwalten
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
      <div className="menubar-right">
        <div className="menubar-theme" role="group" aria-label="Farbschema">
          <button
            type="button"
            className={
              "menubar-theme-btn" + (theme === "light" ? " menubar-theme-btn--active" : "")
            }
            aria-pressed={theme === "light"}
            onClick={() => onThemeChange("light")}
            title="Helles Design"
          >
            Hell
          </button>
          <button
            type="button"
            className={
              "menubar-theme-btn" + (theme === "dark" ? " menubar-theme-btn--active" : "")
            }
            aria-pressed={theme === "dark"}
            onClick={() => onThemeChange("dark")}
            title="Dunkles Design"
          >
            Dunkel
          </button>
        </div>
        <div
          className="menubar-font-scale"
          role="group"
          aria-label="Schriftgröße der Anwendung"
        >
          <span className="menubar-font-scale-label" id="menubar-font-scale-label">
            Schrift
          </span>
          <button
            type="button"
            aria-label="Schrift verkleinern"
            aria-describedby="menubar-font-scale-label"
            disabled={fontScaleDecDisabled}
            onClick={onFontScaleDec}
          >
            −
          </button>
          <span className="menubar-font-scale-value" aria-live="polite">
            {Math.round(fontScale * 100)}%
          </span>
          <button
            type="button"
            aria-label="Schrift vergrößern"
            aria-describedby="menubar-font-scale-label"
            disabled={fontScaleIncDisabled}
            onClick={onFontScaleInc}
          >
            +
          </button>
          <button
            type="button"
            className="menubar-font-scale-reset"
            aria-label="Schriftgröße auf Standard zurücksetzen"
            disabled={fontScale === 1}
            onClick={onFontScaleReset}
            title="Standard (100 %)"
          >
            Std.
          </button>
        </div>
        {infoMessage ? (
          <span className="menubar-info" role="status" aria-live="polite">
            {infoMessage}
          </span>
        ) : null}
      </div>
    </nav>
  );
}
