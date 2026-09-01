"use client";

import { t } from "@/lib/i18n";

/* ------------------------------------------------------------------
   The only round thing on the page, and deliberately so: it is the label
   at the centre of a record. The ring fills as the snippet runs, which at
   a tenth of a second is the only way to see that anything happened.
   ------------------------------------------------------------------ */

interface PlayControlProps {
  onPlay: () => void;
  playing: boolean;
  progress: number;
  disabled?: boolean;
  label: string;
}

const SIZE = 132;
const STROKE = 3;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function PlayControl({ onPlay, playing, progress, disabled, label }: PlayControlProps) {
  return (
    <div className="flex items-center gap-6">
      <button
        type="button"
        onClick={onPlay}
        disabled={disabled}
        aria-label={t("a11y.playButton")}
        className="group relative shrink-0 disabled:cursor-not-allowed disabled:opacity-40"
        style={{ width: SIZE, height: SIZE }}
      >
        <svg width={SIZE} height={SIZE} className="absolute inset-0 -rotate-90">
          <circle
            cx={SIZE / 2} cy={SIZE / 2} r={RADIUS}
            fill="none" stroke="var(--color-ink-edge)" strokeWidth={STROKE}
          />
          <circle
            cx={SIZE / 2} cy={SIZE / 2} r={RADIUS}
            fill="none" stroke="var(--color-flame)" strokeWidth={STROKE}
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - (playing ? progress : 0))}
            style={{ transition: playing ? "none" : "stroke-dashoffset 200ms linear" }}
          />
        </svg>

        <span
          className={`absolute inset-[14px] rounded-full transition-colors duration-150 ${
            playing ? "bg-flame" : "bg-paper group-hover:bg-flame"
          }`}
        />

        <svg
          viewBox="0 0 24 24"
          className={`absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 transition-colors duration-150 ${
            playing ? "text-ink" : "text-ink"
          }`}
          fill="currentColor"
          aria-hidden="true"
        >
          {playing ? (
            <>
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </>
          ) : (
            <path d="M7 3.5 20 12 7 20.5Z" />
          )}
        </svg>
      </button>

      <div className="min-w-0">
        <div className="type-eyebrow text-paper-faint">{t("round.listen")}</div>
        <div className="type-data mt-1 text-sm text-paper-dim">{label}</div>
      </div>
    </div>
  );
}
