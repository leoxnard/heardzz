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

/* ------------------------------------------------------------------
   One context for the whole page.

   A browser only hands out a handful of AudioContexts per tab — six in
   Chrome, fewer in Safari — and every one that is created and not closed
   counts against that. A hook that built its own per mount ran the tab out
   of them after enough navigating between game, editor and workbench, and
   the symptom is silence with no error: the calls all succeed, nothing
   sounds. Opening another browser "fixed" it because the count started over.

   So the context lives at module scope, is built once, and is never leaked.
   AudioBuffers are not bound to the context that decoded them, so it can be
   rebuilt underneath a decoded clip without re-fetching anything.
   ------------------------------------------------------------------ */

let sharedContext: AudioContext | null = null;
let wakeListenersAttached = false;

/**
 * Whatever is currently sounding, so starting something else can silence it.
 *
 * They share one context and one pair of speakers, so two players are two
 * players at once — which in the library screen means auditioning the
 * soloist against the bass and hearing neither. There is no case anywhere
 * for a second thing playing over the first, so this is enforced here
 * rather than left to each screen to remember.
 */
let sounding: { owner: object; stop: () => void } | null = null;

/* ------------------------------------------------------------------
   What the space bar means.

   A screen with one player can bind space to it. The library screen has
   four — the clip and the three layers cut from it — and binding space to
   the first of them makes the other three unreachable from the keyboard and
   turns "stop this" into "stop this and start something else".

   So space asks two questions in order. Something sounding? Stop it, and
   only it. Nothing sounding but the pointer over a waveform? Play that one,
   from where the pointer is, because that is the gesture: point at the bar
   you want to hear and press space. Neither? Fall back to whatever the
   screen considers its main clip.
   ------------------------------------------------------------------ */

let aimed: { owner: object; at: number; play: (at: number) => void } | null = null;

/**
 * Report the pointer over a waveform, or `null` when it leaves.
 *
 * The owner is what makes leaving safe: a component clearing on its way out
 * must not wipe an aim the pointer has already moved on to.
 */
export function aim(
  owner: object,
  target: { at: number; play: (at: number) => void } | null,
): void {
  if (target === null) {
    if (aimed?.owner === owner) aimed = null;
    return;
  }
  aimed = { owner, ...target };
}

/** Whether anything at all is sounding, for a screen that wants to say so. */
export function anythingSounding(): boolean {
  return sounding !== null;
}

/** What space does, given what the screen would do on its own. */
export function pressSpace(fallback?: () => void): void {
  if (sounding) {
    sounding.stop();
    return;
  }
  if (aimed) {
    aimed.play(aimed.at);
    return;
  }
  fallback?.();
}

/** The ring/silent switch is an iPhone and iPad part. iPadOS reports
 *  itself as a Mac, so touch points are what separate the two. */
function hasSilentSwitch(): boolean {
  const { platform, maxTouchPoints } = navigator;
  if (/iPhone|iPad|iPod/.test(platform)) return true;
  return platform === "MacIntel" && maxTouchPoints > 1;
}

/**
 * iOS routes Web Audio through a session category that the ring/silent
 * switch mutes. Declaring the page as playback moves it to the category
 * used by media players, which the switch does not touch — the same reason
 * a podcast keeps playing on a silenced phone. Safari 16.4+; older iOS
 * keeps the old behaviour and still needs the switch off.
 *
 * Only where that switch exists. A playback session is also what puts a
 * page into the system's Now Playing controls, and on the desktop that is
 * all cost and no benefit: the page becomes something the machine can pause
 * — from the media keys, or when speech or an assistant takes the output —
 * and a session paused from outside the page does not come back on its own.
 * Half-second snippets have no business in a transport bar.
 */
function preferPlaybackSession(): void {
  if (!hasSilentSwitch()) return;
  const session = (navigator as Navigator & { audioSession?: { type: string } })
    .audioSession;
  if (!session) return;
  try {
    session.type = "playback";
  } catch {
    /* not settable on this browser */
  }
}

/**
 * A context that was running when the tab was hidden — or when the phone
 * locked, or a call came in — comes back "suspended" or, on Safari,
 * "interrupted", and stays that way until something resumes it. Nothing in
 * a snippet player naturally does, so the next click is silent.
 */
function attachWakeListeners(): void {
  if (wakeListenersAttached) return;
  wakeListenersAttached = true;

  const wake = () => {
    const ctx = sharedContext;
    if (!ctx || ctx.state === "closed" || ctx.state === "running") return;
    void ctx.resume().catch(() => {});
  };

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) wake();
  });
  window.addEventListener("pageshow", wake);
  window.addEventListener("focus", wake);
}

function createContext(): AudioContext {
  preferPlaybackSession();
  attachWakeListeners();
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  clockProbe = null;
  return new Ctor();
}

function sharedAudioContext(): AudioContext {
  if (!sharedContext || sharedContext.state === "closed") {
    sharedContext = createContext();
  }
  return sharedContext;
}

/**
 * After a long sleep a context can report "running" while its clock has
 * stopped advancing. Everything scheduled against it lands at a time that
 * never arrives, so playback is silent and no error is raised. Comparing
 * the audio clock against the wall clock between two plays catches it; a
 * merely suspended context reports its state honestly and is excluded.
 */
let clockProbe: { contextTime: number; wallTime: number } | null = null;

function clockIsStalled(ctx: AudioContext): boolean {
  const wallTime = performance.now();
  const previous = clockProbe;
  clockProbe = { contextTime: ctx.currentTime, wallTime };

  if (!previous || ctx.state !== "running") return false;
  const wallElapsed = (wallTime - previous.wallTime) / 1000;
  if (wallElapsed < 1) return false;
  return ctx.currentTime - previous.contextTime < wallElapsed / 10;
}

/** A context that is awake and whose clock is moving, rebuilt if need be. */
async function readyContext(): Promise<AudioContext> {
  let ctx = sharedAudioContext();

  if (ctx.state !== "running") {
    preferPlaybackSession();
    try {
      await ctx.resume();
    } catch {
      /* handled by the stall check below */
    }
  }

  // Two ways to be awake on paper and silent in fact. A context whose
  // session the system took away — speech, an assistant, a call, a pause
  // from the machine's own media controls — reports "interrupted" or
  // "suspended" and refuses to resume however often it is asked. And one
  // that survived a long sleep can report "running" over a clock that has
  // stopped. Neither raises an error, and neither recovers by waiting.
  // A context is cheap; the fix for both is to stop nursing this one.
  if (ctx.state !== "running" || clockIsStalled(ctx)) {
    const dead = ctx;
    sharedContext = null;
    try {
      await dead.close();
    } catch {
      /* already gone */
    }
    ctx = sharedAudioContext();
    try {
      await ctx.resume();
    } catch {
      /* nothing further to try */
    }
  }

  return ctx;
}

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
  const gainRef = useRef<{ context: AudioContext; gain: GainNode } | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const frameRef = useRef<number | null>(null);
  const spanRef = useRef<{ startedAt: number; duration: number } | null>(null);
  const playTokenRef = useRef(0);
  /** Stable identity for this player, so the registry can tell it apart. */
  const ownerRef = useRef({});

  const [status, setStatus] = useState<AudioStatus>("idle");
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  // The gain belongs to whichever context is current; a rebuilt context
  // needs a new one, and the old one is dropped with it.
  const gainFor = useCallback((ctx: AudioContext) => {
    const existing = gainRef.current;
    if (existing && existing.context === ctx) return existing.gain;
    existing?.gain.disconnect();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gainRef.current = { context: ctx, gain };
    return gain;
  }, []);

  const stop = useCallback(() => {
    if (sounding?.owner === ownerRef.current) sounding = null;
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
    // A play still waiting on resume must not sound after a stop.
    playTokenRef.current += 1;
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
        const decoded = await sharedAudioContext().decodeAudioData(bytes);
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
  }, [src, stop]);

  const play = useCallback(
    (offsetSeconds: number, durationSeconds: number) => {
      if (!buffer) return;
      /*
       * A non-finite offset or length reaches the gain ramp as NaN, and the
       * Web Audio API answers that with a thrown TypeError from inside a
       * promise — which surfaces as a player that silently does nothing.
       * Cheaper to refuse it here than to find it there.
       */
      if (!Number.isFinite(offsetSeconds) || !Number.isFinite(durationSeconds)) return;
      // Silence whatever else was sounding first. One context, one pair of
      // speakers: two players at once is two players at once.
      if (sounding && sounding.owner !== ownerRef.current) sounding.stop();
      stop();
      sounding = { owner: ownerRef.current, stop };

      const decoded = buffer;
      const token = playTokenRef.current;

      const schedule = (ctx: AudioContext) => {
        const gain = gainFor(ctx);

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
      // envelope in the past, which is heard as a late or missing start. So
      // every play goes through readyContext, which resumes what is asleep
      // and replaces what never woke up.
      void readyContext().then((ctx) => {
        // A stop, or a newer play, happened while we were waiting.
        if (playTokenRef.current !== token) return;
        schedule(ctx);
      });
    },
    [buffer, gainFor, stop, volume],
  );

  useEffect(() => stop, [stop]);

  // The context is shared and outlives this hook; only the node it owns
  // goes. Closing the context here is what used to leak it instead: the ref
  // was read at mount, when it was still null, so nothing was ever closed.
  useEffect(
    () => () => {
      gainRef.current?.gain.disconnect();
      gainRef.current = null;
    },
    [],
  );

  return { status, isPlaying, progress, buffer, play, stop };
}

/** "0.1 s", "2 s", "20 s" — no trailing zeroes, no millisecond noise. */
export function formatSnippet(ms: number): string {
  if (ms < 1000) {
    /*
     * Two places, then trimmed back to whatever the number actually needs.
     * One place was enough while every rung under a second was a half or a
     * tenth; the quarter-second ladder the easy for-you round runs on would
     * have been rounded to "0.3 s", which is a rung that does not exist.
     */
    const seconds = ms / 1000;
    return `${seconds.toFixed(2).replace(/0$/, "").replace(/\.0$/, "")} s`;
  }
  const seconds = ms / 1000;
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} s`;
}
