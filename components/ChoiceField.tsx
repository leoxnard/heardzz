"use client";

import { useMemo } from "react";
import { seedFrom, shuffle } from "@/lib/daily";
import { t } from "@/lib/i18n";

/* ------------------------------------------------------------------
   The same question, asked the easy way.

   Five names, one of them right. The decoys come from the same lexicon the
   typing field suggests from, so they are all plausible answers rather than
   four obvious throwaways — and they are drawn with a seed taken from the
   record's own id, so they stay put across a re-render and a reload. A set
   that reshuffled itself would leak the answer to anyone who looked twice.
   ------------------------------------------------------------------ */

const OPTION_COUNT = 5;

interface ChoiceFieldProps {
  label: string;
  /** Seeds the draw. The record's id. */
  seed: string;
  answer: string;
  pool: string[];
  onPick: (value: string) => void;
  /** Values already tried and wrong, struck out rather than removed. */
  rejected: string[];
  solved: boolean;
  solvedLabel: string;
  disabled?: boolean;
}

export function ChoiceField({
  label, seed, answer, pool, onPick, rejected, solved, solvedLabel, disabled,
}: ChoiceFieldProps) {
  const options = useMemo(() => {
    const decoys = shuffle(
      pool.filter((value) => value !== answer),
      seedFrom(seed),
    ).slice(0, OPTION_COUNT - 1);
    return shuffle([answer, ...decoys], seedFrom(`${seed}:order`));
  }, [pool, answer, seed]);

  if (solved) {
    return (
      <div className="border border-flame bg-flame px-4 py-3">
        <div className="type-eyebrow text-ink/70">{solvedLabel}</div>
        <div className="type-display mt-1 text-2xl text-ink">{answer}</div>
      </div>
    );
  }

  return (
    <div>
      <span className="type-eyebrow block text-paper-faint">{label}</span>
      <p className="type-body mt-1 text-xs text-paper-faint">{t("round.choiceHelp")}</p>

      <ul className="mt-3 space-y-2">
        {options.map((option) => {
          const out = rejected.includes(option);
          return (
            <li key={option}>
              <button
                type="button"
                disabled={disabled || out}
                onClick={() => onPick(option)}
                className={`type-body w-full border px-4 py-3 text-left text-lg transition-colors duration-150 ${
                  out
                    ? "border-ink-edge text-paper-faint line-through decoration-paper-faint"
                    : "border-ink-edge text-paper hover:border-flame hover:text-flame"
                }`}
              >
                {option}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
