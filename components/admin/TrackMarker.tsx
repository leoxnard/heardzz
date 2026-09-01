"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* ------------------------------------------------------------------
   Marking positions on a whole recording.

   Two rows, and the relationship between them is the whole idea. The lower
   one is the record end to end and never moves. The upper one is a window
   onto it — the seconds around wherever you are working, close enough to
   place a marker on the attack of a note.

   The lit box on the lower row is that window. Drag it and the upper row
   follows, the way panning a map moves what is under the lens. Everything
   marked shows up on both: the top of the tune in paper, every solo in
   flame, so a glance at the lower row says what has been found so far.
   ------------------------------------------------------------------ */

const TOP_HEIGHT = 168;
const OVERVIEW_HEIGHT = 64;
const COLUMN = 2;

// Kept in step with the tokens in globals.css.
const INK_RAISED = "#16140f";
const INK_EDGE = "#24211a";
const PAPER = "#ede6d8";
const PAPER_DIM = "#9c9382";
const PAPER_FAINT = "#6c6555";
const FLAME = "#e8471f";

/** Below two seconds a window is all attack and no context. */
const MIN_VIEW = 2;

export interface TrackMark {
  id: string;
  at: number;
  kind: "start" | "solo";
  label: string;
}

export interface View {
  start: number;
  length: number;
}

interface TrackMarkerProps {
  buffer: AudioBuffer | null;
  duration: number;
  marks: TrackMark[];
  activeId: string;
  onActivate: (id: string) => void;
  onMove: (id: string, at: number) => void;
  /** Seconds into the recording currently sounding, or null. */
  playhead: number | null;
  view: View;
  onView: (view: View) => void;
  loading?: boolean;
}

function timecode(seconds: number, decimals = 0): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest < 10 ? "0" : ""}${rest.toFixed(decimals)}`;
}

/** Peak per column over a stretch of the buffer. */
function peaksOver(
  buffer: AudioBuffer | null,
  from: number,
  to: number,
  columns: number,
): Float32Array | null {
  if (!buffer || columns < 1 || to <= from) return null;
  const data = buffer.getChannelData(0);
  const first = Math.max(0, Math.floor(from * buffer.sampleRate));
  const last = Math.min(data.length, Math.ceil(to * buffer.sampleRate));
  const span = last - first;
  if (span <= 0) return null;

  const out = new Float32Array(columns);
  for (let i = 0; i < columns; i++) {
    const start = first + Math.floor((i * span) / columns);
    const end = Math.max(start + 1, first + Math.floor(((i + 1) * span) / columns));
    let peak = 0;
    // A window may cover a million samples; stepping keeps a redraw honest
    // without changing the shape anybody can see.
    const step = Math.max(1, Math.floor((end - start) / 512));
    for (let j = start; j < end; j += step) {
      const value = Math.abs(data[j]);
      if (value > peak) peak = value;
    }
    out[i] = peak;
  }
  return out;
}

function drawWave(
  ctx: CanvasRenderingContext2D,
  peaks: Float32Array | null,
  width: number,
  height: number,
  color: string,
  alpha: number,
) {
  if (!peaks) return;
  const mid = height / 2;
  const columns = peaks.length;
  const columnWidth = width / columns;
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  for (let i = 0; i < columns; i++) {
    const amplitude = Math.max(0.75, peaks[i] * (height / 2) * 0.94);
    ctx.fillRect(i * columnWidth, mid - amplitude, Math.max(1, columnWidth - 1), amplitude * 2);
  }
  ctx.globalAlpha = 1;
}

function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(240, Math.floor(entry.contentRect.width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

export function TrackMarker({
  buffer, duration, marks, activeId, onActivate, onMove, playhead, view, onView, loading,
}: TrackMarkerProps) {
  const [topRef, topWidth] = useWidth<HTMLDivElement>(880);
  const topCanvas = useRef<HTMLCanvasElement>(null);
  const overviewCanvas = useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = useState<null | { where: "top" | "window"; grabbed: number }>(null);

  const span = Math.max(MIN_VIEW, Math.min(view.length, duration || MIN_VIEW));
  const start = Math.max(0, Math.min(view.start, Math.max(0, (duration || 0) - span)));
  const end = start + span;

  const overviewPeaks = useMemo(
    () => peaksOver(buffer, 0, duration, Math.max(1, Math.floor(topWidth / COLUMN))),
    [buffer, duration, topWidth],
  );

  const windowPeaks = useMemo(
    () => peaksOver(buffer, start, end, Math.max(1, Math.floor(topWidth / COLUMN))),
    [buffer, start, end, topWidth],
  );

  const xOf = useCallback((seconds: number) => ((seconds - start) / span) * topWidth, [start, span, topWidth]);
  const timeAt = useCallback(
    (x: number) => start + (Math.min(topWidth, Math.max(0, x)) / topWidth) * span,
    [start, span, topWidth],
  );

  /* ---------------- the window ---------------- */

  useEffect(() => {
    const canvas = topCanvas.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = topWidth * dpr;
    canvas.height = TOP_HEIGHT * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = INK_RAISED;
    ctx.fillRect(0, 0, topWidth, TOP_HEIGHT);

    // A tick every second, or every five when a second would be a comb.
    const step = span <= 12 ? 1 : span <= 45 ? 5 : span <= 180 ? 15 : 60;
    ctx.font = "10px ui-monospace, monospace";
    for (let s = Math.ceil(start / step) * step; s < end; s += step) {
      const x = xOf(s);
      ctx.fillStyle = INK_EDGE;
      ctx.fillRect(x, 0, 1, TOP_HEIGHT);
      ctx.fillStyle = PAPER_FAINT;
      ctx.fillText(timecode(s), x + 4, TOP_HEIGHT - 6);
    }

    drawWave(ctx, windowPeaks, topWidth, TOP_HEIGHT, PAPER, 0.85);

    if (playhead !== null && playhead >= start && playhead <= end) {
      ctx.fillStyle = FLAME;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(xOf(playhead), 0, 2, TOP_HEIGHT);
      ctx.globalAlpha = 1;
    }

    for (const mark of marks) {
      if (mark.at < start || mark.at > end) continue;
      const x = xOf(mark.at);
      const color = mark.kind === "start" ? PAPER : FLAME;
      const active = mark.id === activeId;

      ctx.fillStyle = color;
      ctx.globalAlpha = active ? 1 : 0.55;
      ctx.fillRect(x - 1, 0, 2, TOP_HEIGHT);
      // The flag sits at the top so two markers a second apart stay legible,
      // and it turns back on itself at the right edge rather than falling off.
      const flag = active ? 14 : 8;
      ctx.fillRect(x + flag > topWidth ? x - flag : x - 1, 0, flag, flag);

      if (active) {
        ctx.font = "11px ui-monospace, monospace";
        ctx.fillStyle = color;
        const label = `${mark.label} · ${timecode(mark.at, 1)}`;
        const textWidth = ctx.measureText(label).width;
        const left = Math.min(topWidth - textWidth - 8, x + 6);
        ctx.fillStyle = INK_RAISED;
        ctx.fillRect(left - 3, 16, textWidth + 6, 15);
        ctx.fillStyle = color;
        ctx.fillText(label, left, 27);
      }
      ctx.globalAlpha = 1;
    }

    ctx.strokeStyle = INK_EDGE;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, topWidth - 1, TOP_HEIGHT - 1);
  }, [windowPeaks, topWidth, start, end, span, marks, activeId, playhead, xOf]);

  /* ---------------- the whole record ---------------- */

  useEffect(() => {
    const canvas = overviewCanvas.current;
    if (!canvas || !duration) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = topWidth * dpr;
    canvas.height = OVERVIEW_HEIGHT * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const x = (seconds: number) => (seconds / duration) * topWidth;

    ctx.fillStyle = INK_RAISED;
    ctx.fillRect(0, 0, topWidth, OVERVIEW_HEIGHT);
    drawWave(ctx, overviewPeaks, topWidth, OVERVIEW_HEIGHT, PAPER_DIM, 0.5);

    // The part on show above.
    const boxLeft = x(start);
    const boxWidth = Math.max(3, x(span));
    ctx.fillStyle = FLAME;
    ctx.globalAlpha = 0.16;
    ctx.fillRect(boxLeft, 0, boxWidth, OVERVIEW_HEIGHT);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = FLAME;
    ctx.lineWidth = 1;
    ctx.strokeRect(boxLeft + 0.5, 0.5, boxWidth - 1, OVERVIEW_HEIGHT - 1);

    for (const mark of marks) {
      const radius = mark.id === activeId ? 6 : 4;
      const cx = Math.min(topWidth - radius, Math.max(radius, x(mark.at)));
      const color = mark.kind === "start" ? PAPER : FLAME;
      ctx.fillStyle = color;
      ctx.globalAlpha = mark.id === activeId ? 1 : 0.7;
      ctx.beginPath();
      ctx.arc(cx, OVERVIEW_HEIGHT / 2, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    if (playhead !== null) {
      ctx.fillStyle = FLAME;
      ctx.fillRect(x(playhead), 0, 1, OVERVIEW_HEIGHT);
    }

    ctx.strokeStyle = INK_EDGE;
    ctx.strokeRect(0.5, 0.5, topWidth - 1, OVERVIEW_HEIGHT - 1);
  }, [overviewPeaks, topWidth, duration, start, span, marks, activeId, playhead]);

  /* ---------------- pointer ---------------- */

  const localX = useCallback(
    (canvas: HTMLCanvasElement | null, clientX: number) => {
      if (!canvas) return 0;
      const rect = canvas.getBoundingClientRect();
      return ((clientX - rect.left) / rect.width) * topWidth;
    },
    [topWidth],
  );

  const moveActive = useCallback(
    (clientX: number) => {
      const at = timeAt(localX(topCanvas.current, clientX));
      onMove(activeId, Number(Math.max(0, Math.min(duration, at)).toFixed(3)));
    },
    [activeId, duration, localX, onMove, timeAt],
  );

  const panTo = useCallback(
    (clientX: number, grabbed: number) => {
      const x = localX(overviewCanvas.current, clientX);
      const centre = (x / topWidth) * duration;
      onView({ start: Math.max(0, Math.min(duration - span, centre - grabbed)), length: span });
    },
    [duration, localX, onView, span, topWidth],
  );

  useEffect(() => {
    if (!drag) return;
    const move = (event: PointerEvent) => {
      if (drag.where === "top") moveActive(event.clientX);
      else panTo(event.clientX, drag.grabbed);
    };
    const up = () => setDrag(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag, moveActive, panTo]);

  function zoom(factor: number, around?: number) {
    const anchor = around ?? start + span / 2;
    const next = Math.max(MIN_VIEW, Math.min(duration || MIN_VIEW, span * factor));
    const ratio = (anchor - start) / span;
    onView({ start: Math.max(0, Math.min(duration - next, anchor - ratio * next)), length: next });
  }

  const disabled = loading || !duration;

  return (
    <div ref={topRef} className="w-full">
      <div className="relative">
        <canvas
          ref={topCanvas}
          style={{
            width: "100%",
            height: TOP_HEIGHT,
            cursor: disabled ? "progress" : "ew-resize",
            touchAction: "none",
          }}
          onPointerDown={(event) => {
            if (disabled) return;
            setDrag({ where: "top", grabbed: 0 });
            moveActive(event.clientX);
          }}
          onWheel={(event) => {
            if (disabled) return;
            zoom(event.deltaY > 0 ? 1.25 : 0.8, timeAt(localX(topCanvas.current, event.clientX)));
          }}
        />
        {loading && (
          <span className="type-eyebrow absolute inset-0 flex items-center justify-center text-paper-faint">
            reading the recording
          </span>
        )}
      </div>

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => zoom(0.5)}
          disabled={disabled}
          className="type-data border border-ink-edge px-3 py-1 text-xs text-paper-dim transition-colors hover:border-flame hover:text-flame disabled:opacity-30"
        >
          zoom in
        </button>
        <button
          type="button"
          onClick={() => zoom(2)}
          disabled={disabled}
          className="type-data border border-ink-edge px-3 py-1 text-xs text-paper-dim transition-colors hover:border-flame hover:text-flame disabled:opacity-30"
        >
          zoom out
        </button>
        <span className="type-data text-xs text-paper-faint">
          {timecode(start)} – {timecode(end)} · {Math.round(span)}s window
        </span>
        <span className="type-data ml-auto text-xs text-paper-faint">{timecode(duration)}</span>
      </div>

      <div className="mt-2">
        <canvas
          ref={overviewCanvas}
          style={{
            width: "100%",
            height: OVERVIEW_HEIGHT,
            cursor: disabled ? "progress" : "grab",
            touchAction: "none",
          }}
          onPointerDown={(event) => {
            if (disabled) return;
            const x = localX(overviewCanvas.current, event.clientX);
            const at = (x / topWidth) * duration;

            // A dot is a smaller target than the window it sits in, so it wins.
            const hit = marks.find((mark) => Math.abs((mark.at / duration) * topWidth - x) < 8);
            if (hit) {
              onActivate(hit.id);
              onView({ start: Math.max(0, Math.min(duration - span, hit.at - span / 2)), length: span });
              return;
            }

            const inside = at >= start && at <= start + span;
            setDrag({ where: "window", grabbed: inside ? at - start : span / 2 });
            panTo(event.clientX, inside ? at - start : span / 2);
          }}
        />
      </div>
    </div>
  );
}
