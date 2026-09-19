import {
  memo,
  useEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
  type KeyboardEvent,
} from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  /** Vom Parent übernommener Filter (z. B. nach „Filter löschen“). */
  value: string;
  onChange: (value: string) => void;
  debounceMs?: number;
  /**
   * Standard: nur Enter übernimmt den Wert (keine Suche beim Tippen).
   * `false` = verzögertes Live-Update (älteres Verhalten).
   */
  commitOnEnter?: boolean;
};

/**
 * Suchfeld: Anzeige sofort lokal. Standardmäßig übernimmt der Parent erst bei Enter.
 */
export const DebouncedSearchInput = memo(function DebouncedSearchInput({
  value,
  onChange,
  debounceMs = 180,
  commitOnEnter = true,
  onKeyDown,
  ...rest
}: Props) {
  const [draft, setDraft] = useState(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (commitOnEnter) return;
    if (draft === value) return;
    const id = window.setTimeout(() => onChangeRef.current(draft), debounceMs);
    return () => window.clearTimeout(id);
  }, [draft, value, debounceMs, commitOnEnter]);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    if (!commitOnEnter) return;
    if (e.key !== "Enter") return;
    if (e.nativeEvent.isComposing) return;
    e.preventDefault();
    const form = e.currentTarget.form;
    if (form) {
      form.requestSubmit();
      return;
    }
    if (draft !== value) onChangeRef.current(draft);
  };

  return (
    <input
      {...rest}
      value={draft}
      onChange={(e) => {
        const next = e.target.value;
        setDraft(next);
        if (commitOnEnter && next === "" && value !== "") {
          onChangeRef.current("");
        }
      }}
      onKeyDown={handleKeyDown}
    />
  );
});
