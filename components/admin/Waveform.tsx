"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* ------------------------------------------------------------------
   Clip waveform with a draggable solo marker.

   Peaks are computed once per buffer and cached; redrawing on resize or on
   a marker move only repaints. The shaded region left of the marker is the
   pre-roll — audio that exists in the file but is never played in a round.
   ------------------------------------------------------------------ */

const COLUMN_WIDTH = 2;
const HEIGHT = 160;

// Kept in step with the tokens in globals.css.
const INK_RAISED = "#16140f";
const INK_EDGE = "#24211a";
const PAPER_DIM = "#9c9382";
const PAPER = "#ede6d8";
const FLAME = "#e8471f";

interface WaveformProps {
  buffer: AudioBuffer | null;
  /** Seconds into the clip where the solo starts. */
  marker: number;
  onMarkerChange: (seconds: number) => void;
  /**
   * Called once when a drag ends, with where it ended.
   *
   * The editor's marker is local state and costs nothing to move, but a
   * stem's is a write and a re-judgement — so the two want different
   * moments. Dragging reports continuously through `onMarkerChange` so the
   * picture follows the pointer; this is where anything expensive goes.
   */
  onCommit?: (seconds: number) => void;
  /** Seconds into the clip currently sounding, or null. */
  playhead: number | null;
  /**
   * Called with where the pointer is over the wave, and with `null` when it
   * leaves. What makes "point at a bar and press space" work.
   */
  onAim?: (seconds: number | null) => void;
  /**
   * Pixels tall. The full-height one is a working surface — an entry point
   * placed to a tenth of a second against the shape of the music. A stem's
   * sits under a row of controls with two more below it, and there it only
   * has to show where the part comes in.
   */
  height?: number;
}

export function Waveform({
  buffer, marker, onMarkerChange, onCommit, playhead, onAim, height = HEIGHT,
}: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(240, Math.floor(entry.contentRect.width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const columns = Math.max(1, Math.floor(width / COLUMN_WIDTH));

  const peaks = useMemo(() => {
    if (!buffer) return null;
    const data = buffer.getChannelData(0);
    const step = Math.floor(data.length / columns) || 1;
    const out = new Float32Array(columns);

    for (let i = 0; i < columns; i++) {
      let peak = 0;
      const start = i * step;
      const end = Math.min(start + step, data.length);
      for (let j = start; j < end; j++) {
        const value = Math.abs(data[j]);
        if (value > peak) peak = value;
      }
      out[i] = peak;
    }
    return out;
  }, [buffer, columns]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !buffer) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = INK_RAISED;
    ctx.fillRect(0, 0, width, height);

    const markerX = (marker / buffer.duration) * width;

    // Pre-roll sits behind a darker ground so it reads as "not in play".
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(0, 0, markerX, height);

    if (peaks) {
      const mid = height / 2;
      for (let i = 0; i < peaks.length; i++) {
        const x = i * COLUMN_WIDTH;
        const amplitude = Math.max(1, peaks[i] * (height / 2) * 0.92);
        ctx.fillStyle = x < markerX ? PAPER_DIM : PAPER;
        ctx.globalAlpha = x < markerX ? 0.35 : 0.9;
        ctx.fillRect(x, mid - amplitude, COLUMN_WIDTH - 1, amplitude * 2);
      }
      ctx.globalAlpha = 1;
    }

    if (playhead !== null) {
      const x = (playhead / buffer.duration) * width;
      ctx.fillStyle = FLAME;
      ctx.globalAlpha = 0.25;
      ctx.fillRect(markerX, 0, Math.max(0, x - markerX), height);
      ctx.globalAlpha = 1;
    }

    ctx.strokeStyle = FLAME;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(markerX, 0);
    ctx.lineTo(markerX, height);
    ctx.stroke();

    ctx.fillStyle = FLAME;
    ctx.fillRect(markerX, 0, 10, 10);

    ctx.strokeStyle = INK_EDGE;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
  }, [buffer, peaks, width, marker, playhead, height]);

  const setFromEvent = useCallback(
    (clientX: number) => {
      const canvas = canvasRef.current;
      if (!canvas || !buffer) return;
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      onMarkerChange(Number((ratio * buffer.duration).toFixed(3)));
    },
    [buffer, onMarkerChange],
  );

  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => setFromEvent(event.clientX);
    const up = (event: PointerEvent) => {
      setDragging(false);
      // Where it ended, from the event rather than from `marker` — the last
      // move and this are the same gesture and props may not have caught up.
      const canvas = canvasRef.current;
      if (!canvas || !buffer || !onCommit) return;
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      const at = Number((ratio * buffer.duration).toFixed(3));
      // A pointerup without usable coordinates would otherwise commit NaN
      // over a perfectly good marker.
      onCommit(Number.isFinite(at) ? at : marker);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [dragging, setFromEvent, buffer, onCommit, marker]);

  return (
    <div ref={wrapRef} className="w-full">
      {buffer ? (
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height, cursor: "ew-resize", touchAction: "none" }}
          onPointerDown={(event) => {
            setDragging(true);
            setFromEvent(event.clientX);
          }}
          onPointerMove={(event) => {
            if (!onAim || !buffer) return;
            const rect = event.currentTarget.getBoundingClientRect();
            const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
            onAim(Number((ratio * buffer.duration).toFixed(3)));
          }}
          onPointerLeave={() => onAim?.(null)}
        />
      ) : (
        <div
          className="type-eyebrow flex items-center justify-center border border-ink-edge bg-ink-raised text-paper-faint"
          style={{ height }}
        >
          loading clip
        </div>
      )}

      {/* Nudging with the keyboard is the only way to be precise to a frame. */}
      <div className="mt-3 flex items-center gap-2">
        {[-1, -0.1, 0.1, 1].map((delta) => (
          <button
            key={delta}
            type="button"
            onClick={() => {
              const next = Number(
                Math.max(0, Math.min(buffer?.duration ?? 0, marker + delta)).toFixed(3),
              );
              onMarkerChange(next);
              // A nudge is its own whole gesture, so it commits immediately.
              onCommit?.(next);
            }}
            disabled={!buffer}
            className="type-data border border-ink-edge px-3 py-1 text-xs text-paper-dim transition-colors hover:border-flame hover:text-flame disabled:opacity-30"
          >
            {delta > 0 ? `+${delta}` : delta}s
          </button>
        ))}
      </div>
    </div>
  );
}
