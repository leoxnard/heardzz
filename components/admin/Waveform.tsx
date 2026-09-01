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
  /** Seconds into the clip currently sounding, or null. */
  playhead: number | null;
}

export function Waveform({ buffer, marker, onMarkerChange, playhead }: WaveformProps) {
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
    canvas.height = HEIGHT * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = INK_RAISED;
    ctx.fillRect(0, 0, width, HEIGHT);

    const markerX = (marker / buffer.duration) * width;

    // Pre-roll sits behind a darker ground so it reads as "not in play".
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(0, 0, markerX, HEIGHT);

    if (peaks) {
      const mid = HEIGHT / 2;
      for (let i = 0; i < peaks.length; i++) {
        const x = i * COLUMN_WIDTH;
        const amplitude = Math.max(1, peaks[i] * (HEIGHT / 2) * 0.92);
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
      ctx.fillRect(markerX, 0, Math.max(0, x - markerX), HEIGHT);
      ctx.globalAlpha = 1;
    }

    ctx.strokeStyle = FLAME;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(markerX, 0);
    ctx.lineTo(markerX, HEIGHT);
    ctx.stroke();

    ctx.fillStyle = FLAME;
    ctx.fillRect(markerX, 0, 10, 10);

    ctx.strokeStyle = INK_EDGE;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, width - 1, HEIGHT - 1);
  }, [buffer, peaks, width, marker, playhead]);

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
    const up = () => setDragging(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [dragging, setFromEvent]);

  return (
    <div ref={wrapRef} className="w-full">
      {buffer ? (
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height: HEIGHT, cursor: "ew-resize", touchAction: "none" }}
          onPointerDown={(event) => {
            setDragging(true);
            setFromEvent(event.clientX);
          }}
        />
      ) : (
        <div
          className="type-eyebrow flex items-center justify-center border border-ink-edge bg-ink-raised text-paper-faint"
          style={{ height: HEIGHT }}
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
            onClick={() =>
              onMarkerChange(
                Number(Math.max(0, Math.min(buffer?.duration ?? 0, marker + delta)).toFixed(3)),
              )
            }
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
