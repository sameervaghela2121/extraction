import { useMemo, useState } from "react";

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * A dropdown that looks and behaves like the vendor picker, for a list already in memory:
 * click to open, type to narrow it down, click an option to pick it. Used in place of the
 * browser's own <select> so every picker in the admin panel looks the same.
 */
export default function SearchSelect({
  options,
  value,
  onChange,
  placeholder = "Search…",
  invalid,
}: {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  invalid?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  return (
    <div className="dropdown">
      <input
        className="input"
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        // Closed, the box shows the chosen option; open, it shows what is being typed.
        value={open ? query : (selected?.label ?? "")}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onBlur={() => setOpen(false)}
        onChange={(e) => setQuery(e.target.value)}
      />
      {open && (
        <div className="dropdown-panel" role="listbox">
          {shown.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              className="dropdown-option"
              // onMouseDown, not onClick: the input's blur fires first on a click and would
              // close this list before the click ever landed on it.
              onMouseDown={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              {o.label}
            </button>
          ))}
          {shown.length === 0 && <div className="dropdown-note">No match.</div>}
        </div>
      )}
    </div>
  );
}
