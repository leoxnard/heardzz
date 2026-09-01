"use client";

import { Overlay } from "./Overlay";
import { formatSnippet } from "@/lib/audio";
import { t } from "@/lib/i18n";
import type { Stats } from "@/lib/types";

interface StatsPanelProps {
  stats: Stats;
  /** The rungs themselves, because the distribution counts seconds heard. */
  ladderMs: number[];
  onReset: () => void;
  onClose: () => void;
}

export function StatsPanel({ stats, ladderMs, onReset, onClose }: StatsPanelProps) {
  const winRate = stats.played === 0 ? 0 : Math.round((stats.won / stats.played) * 100);
  const rows = ladderMs.map((_, i) => stats.distribution[i] ?? 0);
  const peak = Math.max(1, ...rows);

  return (
    <Overlay title={t("stats.title")} onClose={onClose}>
      {stats.played === 0 ? (
        <p className="type-body text-sm text-paper-dim">{t("stats.empty")}</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-px bg-ink-edge">
            <Figure label={t("stats.played")} value={stats.played} />
            <Figure label={t("stats.winRate")} value={`${winRate}%`} />
            <Figure label={t("stats.streak")} value={stats.currentStreak} />
            <Figure label={t("stats.maxStreak")} value={stats.maxStreak} />
          </dl>

          <section className="mt-10 border-t border-ink-edge pt-6">
            <h3 className="type-eyebrow text-flame">{t("stats.distribution")}</h3>
            <ul className="mt-4 space-y-2">
              {rows.map((count, i) => (
                <li key={i} className="flex items-center gap-3">
                  <span className="type-data w-12 text-right text-xs text-paper-faint">
                    {formatSnippet(ladderMs[i])}
                  </span>
                  <div className="h-6 flex-1 bg-ink-raised">
                    {/* Padding gives a zero-width bar a visible stub, so an
                        empty row renders nothing at all. */}
                    {count > 0 && (
                      <div
                        className="flex h-full items-center justify-end bg-flame px-2"
                        style={{ width: `${Math.max(12, (count / peak) * 100)}%` }}
                      >
                        <span className="type-data text-[0.65rem] text-ink">{count}</span>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <button
        type="button"
        onClick={() => {
          if (window.confirm(t("stats.resetConfirm"))) onReset();
        }}
        className="type-eyebrow mt-10 w-full border border-paper-faint py-3 text-paper-dim transition-colors duration-150 hover:border-flame hover:text-flame"
      >
        {t("stats.reset")}
      </button>
    </Overlay>
  );
}

function Figure({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-ink px-4 py-5">
      <dt className="type-eyebrow text-paper-faint">{label}</dt>
      <dd className="type-display mt-2 text-4xl text-paper">{value}</dd>
    </div>
  );
}
