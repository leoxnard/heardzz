"use client";

import { useEffect, useRef } from "react";
import { t } from "@/lib/i18n";
import type { Level, LevelId } from "@/lib/config";

/* ------------------------------------------------------------------
   The level, where you are actually thinking about it.

   It sat over the questions as a line of dead text, and changing it meant
   a trip into settings — past the ladder, the toggles and the volume — for
   the one setting that decides what the round is. So the label became the
   control: same place, same words, now something you can press.

   Settings keeps the level as well. This is the shortcut, not the
   replacement, and the panel is still where a level is read about rather
   than switched between.
   ------------------------------------------------------------------ */

interface LevelPickerProps {
  levels: Level[];
  current: Level;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (id: LevelId) => void;
  /**
   * Set while the level cannot be changed — mid-daily, where a switch
   * would rewrite the questions under answers already given. The label
   * stays; it is the pressing that stops.
   */
  lockedHint?: string;
}

export function LevelPicker({
  levels, current, open, onOpenChange, onPick, lockedHint,
}: LevelPickerProps) {
  const box = useRef<HTMLDivElement>(null);

  /*
   * Escape and a click anywhere else both close it. The game's own key
   * handler stands down while this is open — space plays the record, and
   * a picker that swallows the pointer but not the keyboard is worse than
   * no picker.
   */
  useEffect(() => {
    if (!open) return;

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onOpenChange(false);
    }
    function onPointer(event: PointerEvent) {
      if (!box.current?.contains(event.target as Node)) onOpenChange(false);
    }

    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, onOpenChange]);

  if (lockedHint || levels.length < 2) {
    return (
      <span className="type-eyebrow text-paper-faint" title={lockedHint}>
        {current.label}
      </span>
    );
  }

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={t("level.change")}
        className={`type-eyebrow flex items-center gap-2 border-b border-dotted pb-[2px] transition-colors duration-150 ${
          open
            ? "border-flame text-flame"
            : "border-paper-faint text-paper-dim hover:border-flame hover:text-flame"
        }`}
      >
        {current.label}
        <span aria-hidden="true" className="text-[0.6em] leading-none">▼</span>
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute left-0 top-full z-20 mt-2 w-72 border border-ink-edge bg-ink-raised shadow-lg"
        >
          {levels.map((level) => {
            const active = level.id === current.id;
            return (
              <li key={level.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onPick(level.id);
                    onOpenChange(false);
                  }}
                  className={`block w-full border-b border-ink-edge px-4 py-3 text-left transition-colors duration-150 last:border-b-0 ${
                    active
                      ? "bg-flame text-ink"
                      : "text-paper-dim hover:bg-ink hover:text-paper"
                  }`}
                >
                  <span className="type-eyebrow block">{level.label}</span>
                  <span
                    className={`type-body mt-1 block text-xs ${
                      active ? "text-ink/70" : "text-paper-faint"
                    }`}
                  >
                    {level.blurb}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
