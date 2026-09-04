"use client";

import { t } from "@/lib/i18n";
import { turnsOf } from "@/lib/game";
import type { Attempt } from "@/lib/types";

/* ------------------------------------------------------------------
   The record of what has been tried.

   One row per turn, not per guess. A right answer costs nothing and leaves
   the ladder where it is, so naming the artist and then the tune off the
   same half-second is one turn — and reading down two rows for it said the
   opposite, that the second one had cost something. A row therefore holds
   everything answered on the same rung, side by side, and only a wrong
   answer or a pass closes it, because only those move the ladder.

   Correct answers invert to a solid flame block; wrong ones are struck
   through and dimmed. The distinction never rests on hue alone.

   The empty rows underneath are the budget: one for every wrong answer
   still affordable.
   ------------------------------------------------------------------ */

interface BoardProps {
  attempts: Attempt[];
  missesLeft: number;
}

export function Board({ attempts, missesLeft }: BoardProps) {
  const turns = turnsOf(attempts);
  const blanks = Array.from({ length: missesLeft }, (_, i) => i);

  if (attempts.length === 0 && blanks.length === 0) {
    return <p className="type-body text-sm text-paper-faint">{t("board.empty")}</p>;
  }

  return (
    <ol className="border-t border-ink-edge">
      {turns.map((turn, i) => (
        <li key={i} className="flex items-baseline gap-4 border-b border-ink-edge py-3">
          <span className="type-data w-7 shrink-0 text-xs text-paper-faint">
            {String(i + 1).padStart(2, "0")}
          </span>

          <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-5 gap-y-2">
            {turn.map((attempt, j) => (
              <span key={j} className="flex min-w-0 items-baseline gap-2">
                <span className="type-eyebrow shrink-0 text-paper-faint">
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
              </span>
            ))}
          </div>
        </li>
      ))}

      {blanks.map((i) => (
        <li
          key={`blank-${i}`}
          className="flex items-baseline gap-4 border-b border-ink-edge py-3"
        >
          <span className="type-data w-7 shrink-0 text-xs text-paper-faint">
            {String(turns.length + i + 1).padStart(2, "0")}
          </span>
          <span className="type-body text-sm text-paper-faint">—</span>
        </li>
      ))}
    </ol>
  );
}
