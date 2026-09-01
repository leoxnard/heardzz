"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { suggest, type Suggestion } from "@/lib/lexicon";

/* ------------------------------------------------------------------
   A guess field.

   Nothing is suggested below two characters, so the list can never be
   opened and read as a menu of possible answers — which, with a library
   this size, would be the whole game.
   ------------------------------------------------------------------ */

interface GuessFieldProps {
  label: string;
  placeholder: string;
  pool: string[];
  value: string;
  onChange: (value: string) => void;
  /** Called with an explicit value when Enter accepts a highlighted suggestion. */
  onSubmit: (overrideValue?: string) => void;
  solved: boolean;
  solvedLabel: string;
  solvedValue?: string;
  disabled?: boolean;
  /** Lets the round hand focus back after a guess. */
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

export function GuessField({
  label, placeholder, pool, value, onChange, onSubmit,
  solved, solvedLabel, solvedValue, disabled, inputRef,
}: GuessFieldProps) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);

  const options = useMemo<Suggestion[]>(
    () => (solved || disabled ? [] : suggest(value, pool)),
    [value, pool, solved, disabled],
  );

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  if (solved) {
    return (
      <div className="border border-flame bg-flame px-4 py-3">
        <div className="type-eyebrow text-ink/70">{solvedLabel}</div>
        <div className="type-display mt-1 text-2xl text-ink">{solvedValue}</div>
      </div>
    );
  }

  function choose(option: string) {
    onChange(option);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && options.length) {
      event.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % options.length);
    } else if (event.key === "ArrowUp" && options.length) {
      event.preventDefault();
      setOpen(true);
      setActive((i) => (i <= 0 ? options.length - 1 : i - 1));
    } else if (event.key === "Enter") {
      // A visible highlighted match: take it and check it in one press,
      // whether it is the pre-selected top match or one arrowed to.
      if (showList && active >= 0 && options[active]) {
        event.preventDefault();
        const picked = options[active].value;
        setOpen(false);
        setActive(-1);
        onChange(picked);
        onSubmit(picked);
      } else {
        onSubmit();
      }
    } else if (event.key === "Escape") {
      setOpen(false);
      setActive(-1);
    }
  }

  const showList = open && options.length > 0;

  return (
    <div ref={wrapRef} className="relative">
      <label className="type-eyebrow block text-paper-faint" htmlFor={`${listId}-input`}>
        {label}
      </label>

      <input
        ref={inputRef}
        id={`${listId}-input`}
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        /*
         * "off" is the standard token, but WebKit has a long-standing bug
         * where it ignores it on fields it decides look like a name — which
         * is exactly this field — and offers a macOS Contacts suggestion
         * instead of the game's own list. An arbitrary token outside the
         * autofill spec is not recognised as a request for anything, which
         * Safari and Chrome both then treat as off, reliably.
         */
        autoComplete="not-autofillable"
        spellCheck={false}
        disabled={disabled}
        value={value}
        placeholder={placeholder}
        onChange={(event) => {
          const next = event.target.value;
          onChange(next);
          setOpen(true);
          /*
           * The top match is pre-selected on every keystroke, so a single
           * Enter both fills in the answer and checks it when that top match
           * is right. Computed here rather than derived from `options` in an
           * effect: suggest() is pure, and calling it with the value this
           * keystroke is about to produce keeps active in lockstep with the
           * list it is indexing into, one render sooner than an effect would.
           */
          const upcoming = solved || disabled ? [] : suggest(next, pool);
          setActive(upcoming.length > 0 ? 0 : -1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className="mt-2 w-full border border-ink-edge bg-ink-raised px-4 py-3 text-lg text-paper
                   transition-colors duration-150 placeholder:text-paper-faint
                   hover:border-paper-faint focus:border-flame focus:outline-none
                   disabled:opacity-40"
      />

      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 max-h-64 overflow-y-auto
                     border border-flame bg-ink shadow-none"
        >
          {options.map((option, i) => (
            <li key={option.value} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(option.value)}
                className={`block w-full px-4 py-2 text-left text-[0.95rem] transition-colors duration-100 ${
                  i === active ? "bg-flame text-ink" : "text-paper hover:bg-ink-raised"
                }`}
              >
                {option.value}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
