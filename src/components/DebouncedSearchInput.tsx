import {
  memo,
  useEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
} from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  /** Vom Parent übernommener Filter (z. B. nach „Filter löschen“). */
  value: string;
  onChange: (value: string) => void;
  debounceMs?: number;
};

/**
 * Suchfeld: Anzeige sofort lokal, Parent-Update verzögert — verhindert schwere Re-Renders beim Tippen.
 */
export const DebouncedSearchInput = memo(function DebouncedSearchInput({
  value,
  onChange,
  debounceMs = 180,
  ...rest
}: Props) {
  const [draft, setDraft] = useState(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (draft === value) return;
    const id = window.setTimeout(() => onChangeRef.current(draft), debounceMs);
    return () => window.clearTimeout(id);
  }, [draft, value, debounceMs]);

  return (
    <input
      {...rest}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
    />
  );
});
