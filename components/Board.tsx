"use client";

import { t } from "@/lib/i18n";
import type { Attempt } from "@/lib/types";

/* ------------------------------------------------------------------
   The record of what has been tried.

   One row per guess, tagged with the category it was aimed at, because a
   guess now answers one question rather than all of them at once. Correct
   answers invert to a solid flame block; wrong ones are struck through and
   dimmed. The distinction never rests on hue alone.

   The empty rows underneath are the budget: one for every wrong answer
   still affordable. Right answers add a row without taking one away.
   ------------------------------------------------------------------ */

interface BoardProps {
  attempts: Attempt[];
  missesLeft: number;
}

export function Board({ attempts, missesLeft }: BoardProps) {
  const blanks = Array.from({ length: missesLeft }, (_, i) => i);

  if (attempts.length === 0 && blanks.length === 0) {
    return <p className="type-body text-sm text-paper-faint">{t("board.empty")}</p>;
  }

  return (
    <ol className="border-t border-ink-edge">
      {attempts.map((attempt, i) => (
        <li key={i} className="flex items-baseline gap-4 border-b border-ink-edge py-3">
          <span className="type-data w-7 shrink-0 text-xs text-paper-faint">
            {String(i + 1).padStart(2, "0")}
          </span>
          <span className="type-eyebrow w-20 shrink-0 text-paper-faint">
            {t(`field.${attempt.field}`)}
          </span>
          {attempt.skipped ? (
            <span className="type-eyebrow text-paper-faint">{t("board.skipped")}</span>
          ) : attempt.correct ? (
            <span className="type-body min-w-0 truncate bg-flame px-2 py-[2px] text-sm font-semibold text-ink">
              {attempt.value}
            </span>
          ) : (
            <span className="type-body min-w-0 truncate px-2 py-[2px] text-sm text-paper-dim line-through decoration-paper-faint">
              {attempt.value}
            </span>
          )}
        </li>
      ))}

      {blanks.map((i) => (
        <li
          key={`blank-${i}`}
          className="flex items-baseline gap-4 border-b border-ink-edge py-3"
        >
          <span className="type-data w-7 shrink-0 text-xs text-paper-faint">
            {String(attempts.length + i + 1).padStart(2, "0")}
          </span>
          <span className="type-body text-sm text-paper-faint">—</span>
        </li>
      ))}
    </ol>
  );
}
