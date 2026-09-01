"use client";

import { t } from "@/lib/i18n";
import type { Attempt } from "@/lib/types";

/* ------------------------------------------------------------------
   The record of what has been tried.

   Correct answers invert to a solid flame block; wrong ones are struck
   through and dimmed. The distinction never rests on hue alone.
   ------------------------------------------------------------------ */

interface BoardProps {
  attempts: Attempt[];
  total: number;
  guessSong: boolean;
}

export function Board({ attempts, total, guessSong }: BoardProps) {
  const rows = Array.from({ length: total }, (_, i) => attempts[i] ?? null);

  return (
    <ol className="border-t border-ink-edge">
      {rows.map((attempt, i) => (
        <li
          key={i}
          className="flex items-stretch gap-4 border-b border-ink-edge py-3"
        >
          <span className="type-data w-7 shrink-0 pt-[2px] text-xs text-paper-faint">
            {String(i + 1).padStart(2, "0")}
          </span>

          {attempt === null ? (
            <span className="type-body text-sm text-paper-faint">—</span>
          ) : attempt.skipped ? (
            <span className="type-eyebrow pt-1 text-paper-faint">{t("board.skipped")}</span>
          ) : (
            <div className={`grid min-w-0 flex-1 gap-x-4 gap-y-1 ${guessSong ? "sm:grid-cols-2" : ""}`}>
              <Cell value={attempt.artist} correct={attempt.artistCorrect} />
              {guessSong && <Cell value={attempt.song} correct={attempt.songCorrect} />}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

function Cell({ value, correct }: { value: string | null; correct: boolean }) {
  if (!value) {
    return <span className="type-body truncate text-sm text-paper-faint">—</span>;
  }
  if (correct) {
    return (
      <span className="type-body truncate bg-flame px-2 py-[2px] text-sm font-semibold text-ink">
        {value}
      </span>
    );
  }
  return (
    <span className="type-body truncate px-2 py-[2px] text-sm text-paper-dim line-through decoration-paper-faint">
      {value}
    </span>
  );
}
