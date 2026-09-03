"use client";

import { useMemo } from "react";
import { seedFrom, shuffle } from "@/lib/daily";
import { t } from "@/lib/i18n";

/* ------------------------------------------------------------------
   The same question, asked the easy way.

   Five names, one of them right. They are drawn with a seed taken from the
   record's own id, so they stay put across a re-render and a reload — a set
   that reshuffled itself would leak the answer to anyone who looked twice.

   Which four are wrong is the whole difficulty. Drawing them from the
   lexicon at large made them all *valid* names but not *plausible* ones:
   the answer to a Blakey record would sit beside a swing cornetist, a
   fusion bassist and a free-jazz drummer, and three of those can be ruled
   out without a note being played. So neighbours come first — artists
   Last.fm says sound like the answer, resolved at build time into
   `lib/lexicon/neighbours.ts` — and the lexicon only fills what is left.

   Neighbours are never fetched here. The game does not touch the network
   during a round, and the daily has to hand every player the same five
   names; a live lookup would break both.
   ------------------------------------------------------------------ */

const OPTION_COUNT = 5;

interface ChoiceFieldProps {
  label: string;
  /** Seeds the draw. The record's id. */
  seed: string;
  answer: string;
  pool: string[];
  /**
   * Names that belong beside the answer, best first. Taken before the pool
   * is touched. Empty or absent is not a failure — the draw simply falls
   * back to the pool, which is what it did before neighbours existed.
   */
  near?: string[];
  onPick: (value: string) => void;
  /** Values already tried and wrong, struck out rather than removed. */
  rejected: string[];
  solved: boolean;
  solvedLabel: string;
  disabled?: boolean;
}

export function ChoiceField({
  label, seed, answer, pool, near, onPick, rejected, solved, solvedLabel, disabled,
}: ChoiceFieldProps) {
  const options = useMemo(() => {
    const neighbours = (near ?? []).filter((value) => value !== answer);
    const taken = new Set([answer, ...neighbours]);

    /*
     * Neighbours first, then the rest of the index behind them. Both halves
     * are shuffled, so a record whose neighbour list is longer than four
     * does not offer the same four every time — but the concatenation is
     * ordered, so the pool is only reached for when the neighbours run out.
     */
    const decoys = [
      ...shuffle(neighbours, seedFrom(seed)),
      ...shuffle(pool.filter((value) => !taken.has(value)), seedFrom(`${seed}:rest`)),
    ].slice(0, OPTION_COUNT - 1);

    return shuffle([answer, ...decoys], seedFrom(`${seed}:order`));
  }, [pool, answer, seed, near]);

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
