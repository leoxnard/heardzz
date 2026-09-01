"use client";

import { useEffect, useRef, useState } from "react";
import { formatSnippet } from "@/lib/audio";

/* ------------------------------------------------------------------
   The ladder, drawn as the bands on a record side.

   The strip is a time axis, not six independent meters. Band i covers the
   stretch between the previous rung and its own, so the six bands together
   span the solo from its entry to the longest snippet on offer. Every
   playback starts at the solo entry, so the playhead always sets off from
   the left edge and sweeps back across the bands already earned before it
   reaches new ground.

   The axis is compressed by a fractional power. At true proportion a
   hundred-millisecond rung against a twenty-second one is a hairline, and
   the shape of the ladder — the thing the player is actually reasoning
   about — disappears.
   ------------------------------------------------------------------ */

const COMPRESSION = 0.35;

/** Below this a label would collide with its neighbour, so it is dropped. */
const MIN_LABEL_PX = 30;

interface BandStripProps {
  ladderMs: number[];
  current: number;
  /** Milliseconds into the solo currently sounding, or null when silent. */
  playheadMs: number | null;
}

export function BandStrip({ ladderMs, current, playheadMs }: BandStripProps) {
  const weights = ladderMs.map((ms) => Math.pow(ms, COMPRESSION));
  const total = weights.reduce((a, b) => a + b, 0);

  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={wrapRef}>
      <div className="flex h-12 w-full items-stretch gap-px" aria-hidden="true">
        {ladderMs.map((ms, i) => {
          const unlocked = i <= current;
          const isCurrent = i === current;
          const from = i === 0 ? 0 : ladderMs[i - 1];

          return (
            <div
              key={`${i}-${ms}`}
              className="relative overflow-hidden"
              style={{ flexGrow: weights[i] / total, flexBasis: 0 }}
            >
              <div
                className={
                  unlocked
                    ? isCurrent
                      ? "h-full w-full bg-flame"
                      : "h-full w-full bg-flame-deep"
                    : "h-full w-full bg-ink-raised"
                }
              />
              {playheadMs !== null && (
                <div
                  className="absolute inset-y-0 left-0 bg-paper"
                  style={{ width: `${bandProgress(playheadMs, from, ms) * 100}%` }}
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex w-full items-start gap-px">
        {ladderMs.map((ms, i) => {
          const share = weights[i] / total;
          // Once measured, drop any label whose band is too narrow to hold it.
          const fits = width === 0 || share * width >= MIN_LABEL_PX;

          return (
            <div
              key={`label-${i}-${ms}`}
              style={{ flexGrow: share, flexBasis: 0 }}
              className={`type-data overflow-hidden whitespace-nowrap text-[0.6rem] ${
                i === current
                  ? "text-paper"
                  : i < current
                    ? "text-paper-dim"
                    : "text-paper-faint"
              }`}
            >
              {fits ? formatSnippet(ms).replace(" s", "") : "·"}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * How far the playhead has crossed one band, 0–1.
 *
 * A custom ladder is allowed to run backwards or repeat a value, which leaves
 * a band no width in time; those fill in one step rather than dividing by zero.
 */
function bandProgress(playheadMs: number, from: number, to: number): number {
  const span = to - from;
  if (span <= 0) return playheadMs >= to ? 1 : 0;
  return Math.min(1, Math.max(0, (playheadMs - from) / span));
}
