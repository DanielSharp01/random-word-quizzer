import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

export type PickerOption = {
  key: string;
  label: string;
  /** A second, quieter line, e.g. a section's size. */
  detail?: string;
  /** Draws a line above the option, to set a group apart. */
  separated?: boolean;
};

/**
 * A dropdown that can show a detail line under each option, which a native select can't. It works
 * like one from the keyboard: arrows, Home and End move, Enter or Space picks, Escape closes.
 */
export function Picker({ label, options, value, onChange }: { label: string; options: PickerOption[]; value: string; onChange: (key: string) => void }) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.key === value),
  );
  const [active, setActive] = useState(selectedIndex);
  const selected = options[selectedIndex];

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => {
    if (open) list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function show() {
    setActive(selectedIndex);
    setOpen(true);
  }

  function pick(index: number) {
    const option = options[index];
    if (option) onChange(option.key);
    setOpen(false);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        show();
      }
      return;
    }
    const moves: Record<string, number> = { ArrowDown: active + 1, ArrowUp: active - 1, Home: 0, End: options.length - 1 };
    if (e.key in moves) {
      e.preventDefault();
      setActive(Math.min(options.length - 1, Math.max(0, moves[e.key]!)));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(active);
    } else if (e.key === "Escape" || e.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div className="picker" ref={root}>
      <span className="picker-label" id={`${id}-label`}>
        {label}
      </span>
      <button
        type="button"
        className="picker-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${id}-label ${id}-value`}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        aria-controls={`${id}-list`}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
      >
        <span id={`${id}-value`} className="picker-value">
          <span>{selected?.label}</span>
          {selected?.detail && <span className="picker-detail">{selected.detail}</span>}
        </span>
        <span className="picker-chevron" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <ul className="picker-list" role="listbox" id={`${id}-list`} aria-labelledby={`${id}-label`} ref={list}>
          {options.map((option, index) => (
            <li
              key={option.key}
              id={`${id}-${index}`}
              data-index={index}
              role="option"
              aria-selected={option.key === value}
              className={["picker-option", index === active && "picker-active", option.separated && "picker-separated"].filter(Boolean).join(" ")}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(index)}
            >
              <span>{option.label}</span>
              {option.detail && <span className="picker-detail">{option.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
