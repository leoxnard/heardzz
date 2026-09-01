"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* ------------------------------------------------------------------
   Playback.

   The clip is decoded once into an AudioBuffer and every snippet is a fresh
   BufferSourceNode started with an explicit offset and duration. That is what
   makes a hundred-millisecond window land in the same place every time — the
   scheduling happens on the audio clock, not on a timer.

   The short ramps either side are not polish. Cutting a waveform at a
   non-zero sample produces a click, and at this length the click is louder
   and more informative than the music.
   ------------------------------------------------------------------ */

const FADE_SECONDS = 0.004;

/**
 * Scheduling at exactly currentTime asks the audio thread for something that
 * is already in the past by the time it reads the command, which costs a
 * render quantum and can clip the fade. A couple of milliseconds of lead
 * makes every start land where it was asked for.
 */
const SCHEDULE_LEAD = 0.005;

export type AudioStatus = "idle" | "loading" | "ready" | "error";

export interface SoloAudio {
  status: AudioStatus;
  isPlaying: boolean;
  /** 0–1 through the snippet currently sounding. */
  progress: number;
  buffer: AudioBuffer | null;
  play: (offsetSeconds: number, durationSeconds: number) => void;
  stop: () => void;
}

export function useSoloAudio(src: string | null, volume: number): SoloAudio {
  const contextRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const frameRef = useRef<number | null>(null);
  const spanRef = useRef<{ startedAt: number; duration: number } | null>(null);

  const [status, setStatus] = useState<AudioStatus>("idle");
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  const getContext = useCallback(() => {
    if (!contextRef.current) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctor();
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      contextRef.current = ctx;
      gainRef.current = gain;
    }
    return contextRef.current;
  }, []);

  const stop = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    if (sourceRef.current) {
      try {
        sourceRef.current.stop();
      } catch {
        /* already ended */
      }
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    spanRef.current = null;
    setIsPlaying(false);
    setProgress(0);
  }, []);

  useEffect(() => {
    let cancelled = false;

    // Decoding is an external system; its lifecycle belongs in an effect.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (!src) {
      setBuffer(null);
      setStatus("idle");
      return;
    }

    setStatus("loading");
    setBuffer(null);
    /* eslint-enable react-hooks/set-state-in-effect */

    (async () => {
      try {
        const response = await fetch(src);
        if (!response.ok) throw new Error(`${response.status}`);
        const bytes = await response.arrayBuffer();
        const decoded = await getContext().decodeAudioData(bytes);
        if (cancelled) return;
        setBuffer(decoded);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      // Moving to another solo has to silence the one still sounding.
      stop();
    };
  }, [src, getContext, stop]);

  const play = useCallback(
    (offsetSeconds: number, durationSeconds: number) => {
      if (!buffer) return;
      stop();

      const decoded = buffer;
      const ctx = getContext();

      const schedule = () => {
        const gain = gainRef.current;
        if (!gain) return;

        const offset = Math.max(0, Math.min(offsetSeconds, decoded.duration));
        const duration = Math.max(
          0.01,
          Math.min(durationSeconds, decoded.duration - offset),
        );

        const source = ctx.createBufferSource();
        source.buffer = decoded;
        source.connect(gain);

        const now = ctx.currentTime + SCHEDULE_LEAD;
        const fade = Math.min(FADE_SECONDS, duration / 4);
        const level = Math.max(0.0001, volume);

        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(level, now + fade);
        gain.gain.setValueAtTime(level, now + duration - fade);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

        source.start(now, offset, duration);
        sourceRef.current = source;
        spanRef.current = { startedAt: now, duration };
        setIsPlaying(true);
        setProgress(0);

        source.onended = () => {
          if (sourceRef.current !== source) return;
          sourceRef.current = null;
          spanRef.current = null;
          setIsPlaying(false);
          setProgress(0);
        };

        const tick = () => {
          const span = spanRef.current;
          if (!span) return;
          const elapsed = ctx.currentTime - span.startedAt;
          setProgress(Math.min(1, Math.max(0, elapsed / span.duration)));
          if (elapsed < span.duration) {
            frameRef.current = requestAnimationFrame(tick);
          }
        };
        frameRef.current = requestAnimationFrame(tick);
      };

      // A context built before the first gesture starts suspended, and a
      // suspended clock is frozen — scheduling against it puts the whole
      // envelope in the past, which is heard as a late or missing start.
      // Resume first, then schedule against a clock that is running.
      if (ctx.state === "suspended") {
        void ctx.resume().then(schedule);
        return;
      }
      schedule();
    },
    [buffer, getContext, stop, volume],
  );

  useEffect(() => stop, [stop]);

  useEffect(() => {
    const ctx = contextRef.current;
    return () => {
      if (ctx && ctx.state !== "closed") void ctx.close();
    };
  }, []);

  return { status, isPlaying, progress, buffer, play, stop };
}

/** "0.1 s", "2 s", "20 s" — no trailing zeroes, no millisecond noise. */
export function formatSnippet(ms: number): string {
  if (ms < 1000) {
    const seconds = ms / 1000;
    return `${seconds.toFixed(seconds < 0.1 ? 2 : 1).replace(/\.0$/, "")} s`;
  }
  const seconds = ms / 1000;
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} s`;
}
