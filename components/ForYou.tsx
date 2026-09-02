"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Game } from "@/components/Game";
import type { Solo } from "@/lib/types";
import type { Candidate } from "@/lib/tidal-candidates";

/* ------------------------------------------------------------------
   A sitting built out of somebody's taste, fetched while they play.

   The waiting is the whole design problem. A record takes a download and
   a cut to become playable, and no amount of cleverness makes that
   instant — so the only question is who waits and for how long. The
   answer here: once, for the first one, and never again. The rest are
   pulled down in the background while the first is being played, which
   is time that was going to be spent listening anyway.
   ------------------------------------------------------------------ */

type Phase = "idle" | "planning" | "fetching" | "playing";

/** Keep this many playable rounds ahead of whoever is playing. */
const BUFFER = 3;
/** Below this many untried candidates, go back to TIDAL for more. */
const REPLAN_AT = 4;

/**
 * Everything needed to pick a sitting back up, written after every arrival
 * so a reload lands where the listener left off rather than at the door.
 * `heardzz:practice:v1` already survives a reload on its own — this is the
 * rest of what that number needs to mean something: which records it is
 * counting into.
 */
const SESSION_STORAGE_KEY = "heardzz:foryou:v1";

interface StoredSession {
  target: string;
  source: string;
  reached: string[];
  solos: Solo[];
  queue: Candidate[];
  offered: string[];
}

export function ForYou() {
  const [target, setTarget] = useState("");
  const [words, setWords] = useState("");
  const [listener, setListener] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [solos, setSolos] = useState<Solo[]>([]);
  const [source, setSource] = useState("");
  const [reached, setReached] = useState<string[]>([]);
  const [ready, setReady] = useState(0);
  /** Candidates still untried. Drained as rounds are fetched, never reused. */
  const queue = useRef<Candidate[]>([]);
  const topping = useRef(false);
  /** Mirrors the queue's length for the screen, which may not read a ref. */
  const [remaining, setRemaining] = useState(0);
  /**
   * Every record this sitting has already offered, as "artist|song".
   *
   * The supply is refilled by asking TIDAL again, and a second pass over
   * the same taste reaches some of the same artists — so without this a
   * long sitting would eventually repeat itself, which is the one thing it
   * must not do.
   */
  const offered = useRef(new Set<string>());
  const planning = useRef(false);

  /** Guards against a second run being started over a running one. */
  const running = useRef(false);
  /** The link this sitting was built from, for asking again. */
  const targetRef = useRef("");

  /*
   * Mirrors of state that a background arrival needs to write to storage
   * without waiting for React to re-render first — `solos` read inside a
   * callback closed over at mount would still be the empty array it opened
   * with.
   */
  const solosRef = useRef<Solo[]>([]);
  const sourceRef = useRef("");
  const reachedRef = useRef<string[]>([]);

  const persistSession = useCallback(() => {
    if (!targetRef.current) return;
    try {
      const session: StoredSession = {
        target: targetRef.current,
        source: sourceRef.current,
        reached: reachedRef.current,
        solos: solosRef.current,
        queue: queue.current,
        offered: Array.from(offered.current),
      };
      window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    } catch {
      // Nothing worth resuming is worth failing the sitting over.
    }
  }, []);

  /** Pick up a sitting left mid-play, rather than starting the listener over. */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as Partial<StoredSession>;
      if (!data.target || !Array.isArray(data.solos) || data.solos.length === 0) return;

      targetRef.current = data.target;
      setTarget(data.target);
      sourceRef.current = data.source ?? "";
      setSource(data.source ?? "");
      reachedRef.current = data.reached ?? [];
      setReached(data.reached ?? []);
      solosRef.current = data.solos;
      setSolos(data.solos);
      setReady(data.solos.length);
      queue.current = Array.isArray(data.queue) ? data.queue : [];
      setRemaining(queue.current.length);
      offered.current = new Set(data.offered ?? []);
      setPhase("playing");
    } catch {
      // A corrupt session is no different from none.
    }
    // Read once, at mount, before anything else has a chance to touch storage.
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  /** Ask TIDAL for another wave, keeping only what has not been offered. */
  const replan = useCallback(async () => {
    if (planning.current || !targetRef.current) return;
    planning.current = true;
    try {
      const response = await fetch("/api/foryou/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: targetRef.current }),
      });
      const data = await response.json();
      if (!response.ok) return;

      const fresh = (data.candidates as Candidate[]).filter((c) => {
        const key = `${c.artist}|${c.song}`.toLowerCase();
        if (offered.current.has(key)) return false;
        offered.current.add(key);
        return true;
      });

      queue.current = [...queue.current, ...fresh];
      setRemaining(queue.current.length);
      persistSession();
    } catch {
      // The sitting carries on with what it has.
    } finally {
      planning.current = false;
    }
  }, [persistSession]);

  /**
   * Keep the pool topped up, for as long as somebody keeps playing.
   *
   * Runs in the background against a queue of candidates that the plan
   * handed over — far more than anybody will get through — and stops when
   * there are BUFFER rounds in hand. Called again whenever the pool is
   * played down, so the supply is bounded by the taste rather than by a
   * number chosen up front.
   *
   * Records are only ever appended, and `Game` is told to play them in
   * order, so nothing that has been played can come round again.
   *
   * Sequential rather than parallel: each one is a yt-dlp download, and
   * three at once is how you get throttled rather than how you get there
   * faster. A candidate that cannot be confirmed is dropped and the next
   * one tried — that is the duration check turning down a live take, which
   * is normal and not worth showing anybody.
   */
  const topUp = useCallback(async (want: number) => {
    if (topping.current) return;
    topping.current = true;

    try {
      let added = 0;
      while (added < want && queue.current.length > 0) {
        const candidate = queue.current.shift();
        if (!candidate) break;
        setRemaining(queue.current.length);

        try {
          const response = await fetch("/api/foryou/fetch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ candidate }),
          });
          const data = await response.json();
          if (response.ok && data.solo) {
            solosRef.current = [...solosRef.current, data.solo as Solo];
            setSolos(solosRef.current);
            setReady((n) => n + 1);
            setPhase("playing");
            added++;
            persistSession();
          }
        } catch {
          // Dropped, deliberately: see above.
        }
      }
    } finally {
      topping.current = false;
    }
  }, [persistSession]);

  /**
   * Everything a plan response has in common, whichever door it came in by:
   * a pasted TIDAL link, or a few words read by `/api/foryou/from-text`.
   * `resolvedTarget` is what a replan asks for again — the link as pasted
   * for a link, or the artist ids `from-text` resolved to for words, since
   * there is no link to paste a second time.
   */
  async function beginSession(request: () => Promise<Response>, resolvedTarget: string) {
    if (running.current) return;
    running.current = true;
    setPhase("planning");
    setError(null);
    setSolos([]);
    solosRef.current = [];

    try {
      const response = await request();
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not read that");

      targetRef.current = (data.target as string | undefined) ?? resolvedTarget;
      offered.current = new Set(
        (data.candidates as Candidate[]).map((c) => `${c.artist}|${c.song}`.toLowerCase()),
      );
      queue.current = data.candidates as Candidate[];
      setRemaining(queue.current.length);
      sourceRef.current = data.source ?? "";
      setSource(data.source ?? "");
      reachedRef.current = data.reached ?? [];
      setReached(data.reached ?? []);
      setReady(0);
      setPhase("fetching");

      /*
       * The running count is shared with the ordinary practice mode and
       * kept in localStorage, so a fresh sitting would otherwise open
       * part-way through its own order. A sitting starts at its beginning.
       */
      try {
        window.localStorage.setItem("heardzz:practice:v1", "0");
      } catch {
        // A browser refusing storage is not a reason to refuse the sitting.
      }

      void topUp(BUFFER);
    } catch (cause) {
      setPhase("idle");
      setError(cause instanceof Error ? cause.message : "Could not read that");
    } finally {
      running.current = false;
    }
  }

  function start() {
    const trimmed = target.trim();
    void beginSession(
      () =>
        fetch("/api/foryou/plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target: trimmed }),
        }),
      trimmed,
    );
  }

  /** Same sitting, built from a few words instead of a pasted link. */
  function startFromWords() {
    const trimmed = words.trim();
    void beginSession(
      () =>
        fetch("/api/foryou/from-text", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: trimmed }),
        }),
      "",
    );
  }

  /**
   * Same sitting again, built from what somebody has actually listened to.
   * Like the words door, this one resolves to artist ids server-side, so
   * there is no link to replan from and the response carries its own
   * `target`.
   */
  function startFromLastfm() {
    const trimmed = listener.trim();
    void beginSession(
      () =>
        fetch("/api/foryou/lastfm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user: trimmed }),
        }),
      "",
    );
  }

  /**
   * Leave this sitting for another one, entirely — not just a new round
   * within it. The running count is zeroed the way `start` zeroes it for a
   * fresh sitting, since the pool it was counting into no longer exists.
   */
  function switchPlaylist() {
    try {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
      window.localStorage.setItem("heardzz:practice:v1", "0");
    } catch {
      // A browser refusing storage is not a reason to refuse the switch.
    }

    targetRef.current = "";
    sourceRef.current = "";
    reachedRef.current = [];
    solosRef.current = [];
    queue.current = [];
    offered.current = new Set();

    setTarget("");
    setWords("");
    setListener("");
    setSource("");
    setReached([]);
    setSolos([]);
    setReady(0);
    setRemaining(0);
    setError(null);
    setPhase("idle");
  }

  /*
   * Watch how far the player has got and fetch more before they reach the
   * end. The running count lives in localStorage rather than in this
   * component — Game owns the advancing — so it is read rather than
   * subscribed to. A second is far quicker than a round.
   */
  useEffect(() => {
    if (phase !== "playing") return;

    const timer = window.setInterval(() => {
      let played = 0;
      try {
        played = Number(window.localStorage.getItem("heardzz:practice:v1") ?? 0) || 0;
      } catch {
        return;
      }
      const left = solos.length - played;
      if (queue.current.length < REPLAN_AT) void replan();
      if (left < BUFFER && queue.current.length > 0) void topUp(BUFFER - Math.max(0, left));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [phase, solos.length, topUp, replan]);

  if (phase === "playing" && solos.length > 0) {
    return (
      <div className="flex min-h-screen flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-ink-edge px-6 py-3 sm:px-10">
          <p className="type-body text-xs text-paper-faint">
            {solos.length} ready{remaining > 0 ? ", more coming" : ""}
            {source ? ` — from ${source}` : ""}
          </p>
          <button
            type="button"
            onClick={switchPlaylist}
            className="type-eyebrow shrink-0 text-xs text-paper-faint transition-colors hover:text-flame"
          >
            Switch playlist
          </button>
        </div>
        {/* Practice: these are one-off rounds, not a shared daily. */}
        <Game solos={solos} mode="practice" ordered />
      </div>
    );
  }

  const busy = phase === "planning" || phase === "fetching";

  return (
    <div className="mx-auto max-w-2xl px-6 py-16 sm:px-10">
      <h1 className="type-display text-flame">Records for you</h1>
      <p className="type-body mt-4 text-sm leading-relaxed text-paper-faint">
        Paste a public TIDAL playlist. It reads who is on it, widens that to
        artists who sound like them, and builds a round out of records this
        site cannot currently play — fetched while you play the first one.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <input
          type="text"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          placeholder="https://tidal.com/playlist/…"
          disabled={busy}
          className="type-body min-w-0 flex-1 border border-ink-edge bg-ink-raised px-4 py-3 text-sm text-paper focus:border-flame focus:outline-none disabled:opacity-50"
        />
        <button
          type="button"
          onClick={start}
          disabled={busy || !target.trim()}
          className="type-eyebrow border border-paper-faint px-5 py-3 text-paper transition-colors hover:border-flame hover:text-flame disabled:opacity-40"
        >
          {phase === "planning"
            ? "Reading your taste"
            : phase === "fetching"
              ? `Fetching (${ready} ready)`
              : "Build me a round"}
        </button>
      </div>

      <p className="type-eyebrow mt-10 text-paper-faint">Or say who, or what</p>
      <p className="type-body mt-2 text-sm leading-relaxed text-paper-faint">
        No playlist? Name whoever you want to hear, or just describe it —
        a genre, an era, a mood — and a model reads artists out of it. The
        round is built from those, the same way.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <input
          type="text"
          value={words}
          onChange={(event) => setWords(event.target.value)}
          placeholder="Michael Brecker only, or hard bop"
          disabled={busy}
          className="type-body min-w-0 flex-1 border border-ink-edge bg-ink-raised px-4 py-3 text-sm text-paper focus:border-flame focus:outline-none disabled:opacity-50"
        />
        <button
          type="button"
          onClick={startFromWords}
          disabled={busy || !words.trim()}
          className="type-eyebrow border border-paper-faint px-5 py-3 text-paper transition-colors hover:border-flame hover:text-flame disabled:opacity-40"
        >
          {phase === "planning"
            ? "Reading your taste"
            : phase === "fetching"
              ? `Fetching (${ready} ready)`
              : "Build me a round"}
        </button>
      </div>

      <p className="type-eyebrow mt-10 text-paper-faint">Or from Last.fm</p>
      <p className="type-body mt-2 text-sm leading-relaxed text-paper-faint">
        Your username is enough — it reads the artists you have played most
        and builds the round out from those. Nothing to log in to, and it
        only ever reads.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <input
          type="text"
          value={listener}
          onChange={(event) => setListener(event.target.value)}
          placeholder="your last.fm username"
          disabled={busy}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="type-body min-w-0 flex-1 border border-ink-edge bg-ink-raised px-4 py-3 text-sm text-paper focus:border-flame focus:outline-none disabled:opacity-50"
        />
        <button
          type="button"
          onClick={startFromLastfm}
          disabled={busy || !listener.trim()}
          className="type-eyebrow border border-paper-faint px-5 py-3 text-paper transition-colors hover:border-flame hover:text-flame disabled:opacity-40"
        >
          {phase === "planning"
            ? "Reading your taste"
            : phase === "fetching"
              ? `Fetching (${ready} ready)`
              : "Build me a round"}
        </button>
      </div>

      {reached.length > 0 && (
        <p className="type-body mt-4 text-xs leading-relaxed text-paper-faint">
          Reaching for {reached.join(", ")}.
        </p>
      )}
      {error && <p className="type-body mt-4 text-sm text-flame">{error}</p>}
    </div>
  );
}
