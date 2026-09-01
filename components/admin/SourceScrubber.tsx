"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* ------------------------------------------------------------------
   The whole recording, at a glance.

   The waveform above shows only the forty seconds that were cut, which is
   the right scale for nudging a start point and the wrong one for deciding
   it belongs four minutes later. This bar is the recording end to end: the
   cut window sits on it as a block, and dragging anywhere picks a new one.

   Coarse on purpose. Landing near the right minute is this control's job;
   the waveform does the seconds.
   ------------------------------------------------------------------ */

const HEIGHT = 44;

function timecode(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

interface SourceScrubberProps {
  /** Length of the whole recording, in seconds. */
  duration: number;
  /** Where the cut window currently begins in the recording. */
  windowStart: number;
  /** How much of the recording the cut window covers. */
  windowLength: number;
  /** The proposed new start, in seconds. */
  value: number;
  onChange: (seconds: number) => void;
}

export function SourceScrubber({
  duration, windowStart, windowLength, value, onChange,
}: SourceScrubberProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const setFromEvent = useCallback(
    (clientX: number) => {
      const bar = barRef.current;
      if (!bar || duration <= 0) return;
      const rect = bar.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      onChange(Math.round(ratio * duration));
    },
    [duration, onChange],
  );

  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => setFromEvent(event.clientX);
    const up = () => setDragging(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [dragging, setFromEvent]);

  if (duration <= 0) return null;

  const pct = (seconds: number) => `${Math.min(100, Math.max(0, (seconds / duration) * 100))}%`;

  // A tick a minute, unless the recording is long enough for that to be a comb.
  const step = duration > 900 ? 300 : duration > 300 ? 120 : 60;
  const ticks: number[] = [];
  for (let s = step; s < duration; s += step) ticks.push(s);

  return (
    <div>
      <div
        ref={barRef}
        onPointerDown={(event) => {
          setDragging(true);
          setFromEvent(event.clientX);
        }}
        className="relative w-full cursor-ew-resize border border-ink-edge bg-ink-raised"
        style={{ height: HEIGHT, touchAction: "none" }}
      >
        {/* The forty seconds that exist as a file. */}
        <div
          className="absolute inset-y-0 bg-flame-deep/60"
          style={{ left: pct(windowStart), width: pct(Math.min(windowLength, duration)) }}
        />

        {ticks.map((second) => (
          <div
            key={second}
            className="absolute inset-y-0 w-px bg-ink-edge"
            style={{ left: pct(second) }}
          />
        ))}

        {/* Where a re-cut would begin. */}
        <div className="absolute inset-y-0 w-[2px] bg-paper" style={{ left: pct(value) }} />
        <div className="absolute top-0 h-[6px] w-[6px] bg-paper" style={{ left: pct(value) }} />
      </div>

      <div className="mt-2 flex justify-between">
        <span className="type-data text-[0.6rem] text-paper-faint">0:00</span>
        <span className="type-data text-[0.6rem] text-paper">{timecode(value)}</span>
        <span className="type-data text-[0.6rem] text-paper-faint">{timecode(duration)}</span>
      </div>
    </div>
  );
}
