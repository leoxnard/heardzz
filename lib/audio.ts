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

/* ------------------------------------------------------------------
   Waiting on WebKit.

   Every promise Web Audio hands back — resume(), close() — is one the
   browser is free never to settle, and Safari takes that freedom for a
   context whose audio session the system has taken away: the call is
   accepted, the state stays "interrupted", and the promise sits there
   forever. Code that awaits it never reaches the line that would have made
   a sound, so the click does nothing at all — no error, no tab speaker, no
   way out but a reload. That is the shape of the bug this file keeps
   growing to fix.

   So nothing here waits on one of those promises. They are fired and
   forgotten, and what actually became true is read back off ctx.state.
   ------------------------------------------------------------------ */

/** How long a resume gets to show up in the state before it is disbelieved. */
const RESUME_PATIENCE_MS = 400;

/** How often to look, while waiting for that. */
const RESUME_POLL_MS = 25;

/** How long after a start to check that the clock ever reached it. */
const STALL_WATCH_MS = 250;

/**
 * A context that will not sound again whatever is asked of it.
 *
 * "interrupted" is Safari's and is not in the spec's three states, which is
 * why it has to be read as a bare string: the tab lost the audio session —
 * to being hidden a few minutes, to another app, to a call — and the
 * session is not handed back on request. A closed one is past arguing with.
 */
function isSpent(ctx: AudioContext): boolean {
  const state = ctx.state as string;
  return state === "closed" || state === "interrupted";
}

/** Ask a context to wake, without waiting to hear back. */
function nudge(ctx: AudioContext): void {
  try {
    void ctx.resume().catch(() => {});
  } catch {
    /* some states refuse outright; the state is read back either way */
  }
}

/**
 * Give up on a context for good.
 *
 * Not awaited, for the same reason as resume: close() on a context the
 * system has taken away can hang exactly as hard, and the whole point of
 * this call is that we are no longer interested in what it has to say.
 */
function retire(ctx: AudioContext): void {
  if (sharedContext === ctx) {
    sharedContext = null;
    clockProbe = null;
  }
  try {
    void ctx.close().catch(() => {});
  } catch {
    /* already gone */
  }
}

/** Watch the state for a resume to take, up to a point. */
function whenRunning(ctx: AudioContext, patienceMs: number): Promise<boolean> {
  if (ctx.state === "running") return Promise.resolve(true);
  return new Promise((resolve) => {
    const deadline = performance.now() + patienceMs;
    const look = () => {
      if (ctx.state === "running") {
        resolve(true);
        return;
      }
      if (isSpent(ctx) || performance.now() >= deadline) {
        resolve(false);
        return;
      }
      window.setTimeout(look, RESUME_POLL_MS);
    };
    window.setTimeout(look, RESUME_POLL_MS);
  });
}

/**
 * A context that was running when the tab was hidden — or when the phone
 * locked, or a call came in — comes back "suspended" or, on Safari,
 * "interrupted", and stays that way until something resumes it. Nothing in
 * a snippet player naturally does, so the next click is silent.
 *
 * Asking is worth a try, but only a try: without a gesture behind it Safari
 * is entitled to ignore the request, and an interrupted session usually
 * does. So the wake is checked rather than assumed, and a context that did
 * not come back is dropped here, while there is time — which is what leaves
 * the next click free to build a working one inside its own gesture instead
 * of discovering the problem and having no gesture left to fix it with.
 */
function attachWakeListeners(): void {
  if (wakeListenersAttached) return;
  wakeListenersAttached = true;

  const wake = () => {
    const ctx = sharedContext;
    if (!ctx) return;
    if (isSpent(ctx)) {
      retire(ctx);
      return;
    }
    if (ctx.state !== "running") nudge(ctx);

    // A context can also come back from a sleep reporting "running" over a
    // clock that has stopped. Here, off the critical path, that can be
    // settled outright by watching the clock for a moment rather than
    // inferred from a probe taken some unknown time ago.
    const wasAt = ctx.currentTime;
    window.setTimeout(() => {
      if (sharedContext !== ctx) return;
      if (isSpent(ctx)) {
        retire(ctx);
        return;
      }
      if (ctx.state === "running" && ctx.currentTime === wasAt) retire(ctx);
    }, STALL_WATCH_MS);
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

/**
 * The context to play on, decided without waiting for anything.
 *
 * This part has to be synchronous. Safari grants a new context its audio
 * session on the strength of the gesture being handled right now, and a
 * gesture does not survive an await — a context built one await later
 * starts suspended and stays there, which is how the old recovery managed
 * to replace a dead context with a stillborn one. So giving up on a spent
 * context and building its replacement both happen here, inside the click.
 * Only the waiting to see whether a resume took is left to the caller.
 */
function contextForPlay(): AudioContext {
  let ctx = sharedAudioContext();

  // Two ways to be awake on paper and silent in fact: a session the system
  // took away, which refuses to come back however often it is asked, and a
  // context that survived a sleep reporting "running" over a stopped clock.
  // Neither raises an error and neither recovers by waiting. A context is
  // cheap; the fix for both is to stop nursing this one.
  if (isSpent(ctx) || clockIsStalled(ctx)) {
    retire(ctx);
    ctx = sharedAudioContext();
  }

  if (ctx.state !== "running") {
    preferPlaybackSession();
    nudge(ctx);
  }

  return ctx;
}

/** A context that is awake and whose clock is moving, rebuilt if need be. */
async function readyContext(): Promise<AudioContext> {
  const ctx = contextForPlay();
  if (ctx.state === "running") return ctx;
  if (await whenRunning(ctx, RESUME_PATIENCE_MS)) return ctx;

  // A resume that neither took nor answered. Out here the gesture is spent
  // and a new context is the weaker move it would have been inside one —
  // but a context that will not wake is worth nothing, and this one at
  // least might.
  retire(ctx);
  const fresh = sharedAudioContext();
  nudge(fresh);
  await whenRunning(fresh, RESUME_PATIENCE_MS);
  return fresh;
}

export type AudioStatus = "idle" | "loading" | "ready" | "error";

export interface SoloAudio {
  status: AudioStatus;
  isPlaying: boolean;
  /** 0–1 through the snippet currently sounding. */
  progress: number;
  buffer: AudioBuffer | null;
  /**
   * The last play could not get a working audio clock out of the browser,
   * even after building a context from scratch.
   *
   * Everything that can be done from in here has been done at that point,
   * so this exists to be said out loud: a screen that shows it turns a
   * button that does nothing into a page that explains itself.
   */
  asleep: boolean;
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
  const [asleep, setAsleep] = useState(false);

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

      /*
       * `retried` is the budget for the check at the bottom: one replacement
       * context per play. If a fresh context cannot sound either, the fault
       * is not one more context away.
       */
      function schedule(ctx: AudioContext, retried: boolean) {
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
        setAsleep(ctx.state !== "running");

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

        /*
         * Proof, after the fact, that the schedule took.
         *
         * Every line above succeeds on a context whose clock has stopped:
         * the nodes connect, start() is accepted, nothing throws, and the
         * sound never happens because the moment it was booked for never
         * arrives. The clock is the only witness. If it has not reached the
         * start by now — and the source is still sitting there unfinished,
         * which on a live clock it would not be for a snippet this short —
         * then this context is gone. Replace it and play the same snippet
         * again, once, rather than leave a button that did nothing.
         */
        if (retried) return;
        window.setTimeout(() => {
          if (playTokenRef.current !== token) return;
          if (sourceRef.current !== source) return;
          if (ctx.state === "running" && ctx.currentTime > now) return;

          retire(ctx);
          try {
            source.stop();
          } catch {
            /* it never started; that is the whole problem */
          }
          source.disconnect();
          sourceRef.current = null;
          spanRef.current = null;
          if (frameRef.current !== null) {
            cancelAnimationFrame(frameRef.current);
            frameRef.current = null;
          }

          const fresh = sharedAudioContext();
          nudge(fresh);
          void whenRunning(fresh, RESUME_PATIENCE_MS).then(() => {
            if (playTokenRef.current !== token) return;
            schedule(fresh, true);
          });
        }, STALL_WATCH_MS);
      }

      // A context built before the first gesture starts suspended, and a
      // suspended clock is frozen — scheduling against it puts the whole
      // envelope in the past, which is heard as a late or missing start. So
      // every play goes through readyContext, which resumes what is asleep
      // and replaces what never woke up.
      void readyContext().then((ctx) => {
        // A stop, or a newer play, happened while we were waiting.
        if (playTokenRef.current !== token) return;
        schedule(ctx, false);
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

  return { status, isPlaying, progress, buffer, asleep, play, stop };
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
