"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { Game } from "@/components/Game";
import { SiteHeader } from "@/components/SiteHeader";
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
  /**
   * Whether there is any point asking for another wave. False for a sitting
   * built out of somebody's own listening, where the first read was the
   * whole supply — see `/api/foryou/lastfm`. Stored with the rest so a
   * reload does not start asking for waves that were never coming.
   */
  replan: boolean;
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
  /**
   * How many of this sitting's records have been played, read back from the
   * running count `Game` keeps. What the bar reports is what is still to
   * come, not how long the sitting has been going — a number that only ever
   * climbs answers a question nobody asked.
   */
  const [played, setPlayed] = useState(0);
  /** Candidates still untried. Drained as rounds are fetched, never reused. */
  const queue = useRef<Candidate[]>([]);
  /**
   * Which sitting is the current one.
   *
   * A record takes half a minute to come down, and leaving the sitting does
   * not reach into that request and stop it. The arrival used to put the
   * game screen back up — somebody pressing "switch playlist" while one was
   * in flight was thrown back into the round they had just left, by a
   * record belonging to a sitting that no longer existed. So every arrival
   * now checks that it still belongs to the sitting on screen, and one that
   * does not is dropped.
   */
  const sitting = useRef(0);
  /** The sitting whose top-up loop is running, if any. */
  const toppingFor = useRef<number | null>(null);
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
  /**
   * Whether asking again would bring anything back. A round built out of
   * somebody's own listening arrives complete — the one read was the whole
   * supply — so this stops the poll below from spending that sitting's
   * remaining reads on a question with no new answer.
   */
  const canReplan = useRef(true);
  /** Mirrors it for the screen, which may not read a ref. */
  const [canAsk, setCanAsk] = useState(true);

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
        replan: canReplan.current,
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
      // Sittings stored before there were two difficulties carry no flag,
      // and every one of those was a widened round that could be asked again.
      canReplan.current = data.replan ?? true;
      setCanAsk(canReplan.current);
      setPhase("playing");
    } catch {
      // A corrupt session is no different from none.
    }
    // Read once, at mount, before anything else has a chance to touch storage.
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  /** Ask TIDAL for another wave, keeping only what has not been offered. */
  const replan = useCallback(async () => {
    if (planning.current || !targetRef.current || !canReplan.current) return;
    const mine = sitting.current;
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

      if (sitting.current !== mine) return;
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
    const mine = sitting.current;
    if (toppingFor.current === mine) return;
    toppingFor.current = mine;

    try {
      let added = 0;
      while (added < want && queue.current.length > 0) {
        if (sitting.current !== mine) return;
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
          // The sitting can have been left while this was in the air, and a
          // record nobody is waiting for is not worth putting on screen.
          if (sitting.current !== mine) return;
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
      // Only if it is still ours: a newer sitting may already hold the lock.
      if (toppingFor.current === mine) toppingFor.current = null;
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
    const mine = (sitting.current += 1);
    setPhase("planning");
    setError(null);
    setSolos([]);
    solosRef.current = [];

    try {
      const response = await request();
      const data = await response.json();
      if (sitting.current !== mine) return;
      if (!response.ok) throw new Error(data.error ?? "Could not read that");

      targetRef.current = (data.target as string | undefined) ?? resolvedTarget;
      // Only the easy Last.fm round says no; every other door can be asked
      // for another wave and so leaves this unset.
      canReplan.current = (data.replan as boolean | undefined) ?? true;
      setCanAsk(canReplan.current);
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
      setPlayed(0);
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
      if (sitting.current !== mine) return;
      setPhase("idle");
      setError(cause instanceof Error ? cause.message : "Could not read that");
    } finally {
      running.current = false;
    }
  }

  /**
   * A pasted link, read one of two ways.
   *
   * "inside" plays what is on the list. "wider" reads it for who is on it
   * and widens to artists who sound like them — the only reading this door
   * had, and still the right one for somebody handing over a playlist as a
   * description of their taste rather than as a set of questions.
   */
  function start(mode: "inside" | "wider") {
    const trimmed = target.trim();
    void beginSession(
      () =>
        fetch("/api/foryou/plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target: trimmed, mode }),
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
   * The same words, taken as a genre rather than as a description.
   *
   * The door above hands them to a model, which names artists known for the
   * style, each of which is then placed against TIDAL — right for "Michael
   * Brecker only, but not the fusion", and a great deal of machinery for
   * the word "bebop". Last.fm already knows what a tag is best known for,
   * and answers in about a second.
   */
  function startFromTag() {
    const trimmed = words.trim();
    void beginSession(
      () =>
        fetch("/api/foryou/tag", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tag: trimmed }),
        }),
      "",
    );
  }

  /**
   * Same sitting again, built from what somebody has actually listened to,
   * at whichever of the two difficulties they picked.
   *
   * "known" is the gentle one: the records already in their history, so
   * every round is one they have heard — often hundreds of times.
   * "nearby" keeps the anchor but steps off it, to records sitting next to
   * theirs that they have not played.
   *
   * Neither carries a link to replan from, so the response brings its own
   * `target` — and the easy one brings its whole supply at once, which is
   * what `replan: false` in that response settles.
   */
  function startFromLastfm(mode: "known" | "nearby") {
    const trimmed = listener.trim();
    void beginSession(
      () =>
        fetch("/api/foryou/lastfm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user: trimmed, mode }),
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

    // Anything already in the air belongs to the sitting being left.
    sitting.current += 1;
    planning.current = false;

    targetRef.current = "";
    sourceRef.current = "";
    reachedRef.current = [];
    solosRef.current = [];
    queue.current = [];
    offered.current = new Set();
    canReplan.current = true;
    setCanAsk(true);

    setTarget("");
    setWords("");
    setListener("");
    setSource("");
    setReached([]);
    setSolos([]);
    setReady(0);
    setPlayed(0);
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

    function tick() {
      let done = 0;
      try {
        done = Number(window.localStorage.getItem("heardzz:practice:v1") ?? 0) || 0;
      } catch {
        return;
      }
      setPlayed(done);
      const left = solos.length - done;
      if (queue.current.length < REPLAN_AT) void replan();
      if (left < BUFFER && queue.current.length > 0) void topUp(BUFFER - Math.max(0, left));
    }

    // Once now, so the count on screen is right from the first frame rather
    // than a second late — which on arrival at the last record is the
    // difference between "cueing the next one" and a stale number.
    tick();
    const timer = window.setInterval(tick, 1000);

    return () => window.clearInterval(timer);
  }, [phase, solos.length, topUp, replan]);

  if (phase === "playing" && solos.length > 0) {
    /*
     * Records this sitting can still deal after the one in hand. The count
     * used to be `solos.length`, which counted everything ever fetched —
     * so five rounds in it read "19 ready" while the sitting was in fact
     * one record from the end of what it had.
     */
    const ahead = Math.max(0, solos.length - played - 1);
    /* Played past the end: the next one is still coming down. */
    const cueing = played >= solos.length;

    return (
      <div className="flex min-h-screen flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-ink-edge px-6 py-3 sm:px-10">
          <p className="type-body text-xs text-paper-faint">
            {cueing
              ? "Cueing the next one"
              : ahead > 0
                ? `${ahead} ready to follow`
                : "Last one in hand"}
            {remaining > 0 ? ", more coming" : ""}
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
        {cueing ? (
          /* Nothing to play for a moment. Which is not the same thing as
             nothing to play, and must not read like it. */
          <Cueing exhausted={remaining === 0 && !canAsk} onSwitch={switchPlaylist} />
        ) : (
          /*
            Practice: these are one-off rounds, not a shared daily. And no
            solo levels — nobody has marked a solo on a record that was
            fetched ninety seconds ago, so there is no solo entry to open at.
          */
          <Game
            solos={solos}
            mode="practice"
            ordered
            extraArtists={reached}
            soloLevels={false}
          />
        )}
      </div>
    );
  }

  const busy = phase === "planning" || phase === "fetching";
  const label =
    phase === "planning"
      ? "Reading your taste"
      : phase === "fetching"
        ? `Fetching (${ready} ready)`
        : "Build me a round";

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <div className="mx-auto w-full max-w-5xl px-6 py-16 sm:px-10">
      <p className="type-eyebrow text-paper-faint">Three ways in</p>
      <h1 className="type-display mt-3 text-flame">Records for you</h1>
      <p className="type-body mt-4 max-w-xl text-sm leading-relaxed text-paper-faint">
        A round built out of your own taste, from records this site cannot
        currently play — fetched while you play the first one. Take whichever
        door you already have the key to.
      </p>

      {/*
        One door per source, told apart by its own mark and its own accent
        rather than by the label alone — three identical fields stacked in a
        column made the choice look like a form to fill in top to bottom,
        which it never was. The accent rides a CSS variable so each panel's
        border, focus ring and button follow the mark above them.
      */}
      <div className="mt-12 grid gap-px border border-ink-edge bg-ink-edge lg:grid-cols-3">
        <Door
          index="01"
          accent="#d51007"
          mark={
            <Image
              src="/brand/lastfm.webp"
              alt="Last.fm"
              width={1920}
              height={486}
              /* Brand red on near-black sits close to unreadable at this
                 size, so it gets a touch of lift rather than a recolour. */
              className="h-[1.15rem] w-auto [filter:brightness(1.25)_saturate(1.1)]"
              priority
            />
          }
          title="What you already played"
          blurb="Your username is enough. Play the records already in your history — you have heard every one of them — or keep only your taste and go out to artists you have not."
          placeholder="your last.fm username"
          value={listener}
          onChange={setListener}
          onSubmit={() => startFromLastfm("known")}
          busy={busy}
          label={label}
          lowercase
          submitLabel="Records I know"
          submitHint="Easiest — only tunes your own history says you have played"
          alternates={[
            {
              label: "One step out",
              hint: "Harder — records next to yours, which you have not played",
              onSubmit: () => startFromLastfm("nearby"),
            },
          ]}
        />
        <Door
          index="02"
          accent="var(--color-paper)"
          mark={
            <Image
              src="/brand/tidal-wordmark.png"
              alt="TIDAL"
              width={753}
              height={100}
              className="h-4 w-auto opacity-90"
            />
          }
          title="A playlist you keep"
          blurb="Paste a public TIDAL playlist, artist or track. Play what is on it, or use it as a description of what you want."
          placeholder="https://tidal.com/playlist/…"
          value={target}
          onChange={setTarget}
          onSubmit={() => start("inside")}
          busy={busy}
          label={label}
          submitLabel="What is on it"
          submitHint="Easier — the records actually on the list, nothing else"
          alternates={[
            {
              label: "Things like it",
              hint: "Harder — artists who sound like the ones on the list",
              onSubmit: () => start("wider"),
            },
          ]}
        />
        <Door
          index="03"
          accent="var(--color-flame)"
          /*
            No logo exists for saying what you want, so the mark is the ask
            itself: an oversized quote, set in the display face, standing
            where the two wordmarks stand.
          */
          mark={
            <span
              aria-hidden
              className="type-display block h-5 text-[3rem] leading-[0.42] text-flame"
            >
              &ldquo;&nbsp;&rdquo;
            </span>
          }
          title="Whatever you can name"
          blurb="Name whoever you want to hear, or just describe it — a genre, an era, a mood — and a model reads artists out of it."
          placeholder="Michael Brecker only, or hard bop"
          value={words}
          onChange={setWords}
          onSubmit={startFromWords}
          busy={busy}
          label={label}
          submitHint="A model reads artists out of it, then widens from those"
          alternates={[
            {
              label: "Just the genre",
              hint: "Skip the model — the best-known records under that tag",
              onSubmit: startFromTag,
            },
          ]}
        />
      </div>

      {reached.length > 0 && (
        <p className="type-body mt-6 text-xs leading-relaxed text-paper-faint">
          Reaching for {reached.join(", ")}.
        </p>
      )}
      {error && <p className="type-body mt-6 text-sm text-flame">{error}</p>}
      </div>
    </div>
  );
}

/**
 * The gap between two records.
 *
 * Somebody who answers faster than a download can finish arrives here, and
 * what they used to get was the game's own empty state — "Nothing to play",
 * with an invitation to go and suggest a record, which reads as the sitting
 * being over rather than as a few seconds of waiting. This says the true
 * thing instead, and says it in the shape of a record being cued: the next
 * one is already on its way down.
 */
function Cueing({ exhausted, onSwitch }: { exhausted: boolean; onSwitch: () => void }) {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />
      <div className="flex flex-1 items-center justify-center p-10">
        <div className="max-w-md">
          <span className="type-eyebrow text-flame">
            {exhausted ? "That was the last of it" : "Cueing the next record"}
          </span>
          <h1 className="type-display-tight mt-4 text-5xl text-paper">
            {exhausted ? "Sitting over" : "One moment"}
          </h1>
          <p className="type-body mt-4 text-sm leading-relaxed text-paper-dim">
            {exhausted
              ? "This taste is played out — everything it reached has been dealt. Another playlist, another username, and it starts again."
              : "It is being fetched and cut while you wait, which takes about as long as a chorus. Nobody else is getting this one."}
          </p>

          {exhausted ? (
            <button
              type="button"
              onClick={onSwitch}
              className="type-eyebrow mt-8 bg-flame px-5 py-3 text-ink transition-colors duration-150 hover:bg-paper"
            >
              Build another round
            </button>
          ) : (
            /* Three blocks in the brand mark's own shape, taking their turn
               — a needle finding the groove rather than a spinner. */
            <div className="mt-8 flex gap-2" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="block h-3 w-3 animate-pulse bg-flame"
                  style={{ animationDelay: `${i * 0.25}s`, animationDuration: "1.4s" }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * One way in. Everything that differs between the three — the mark, the
 * accent, the words — arrives as a prop, so the three panels stay one
 * shape without reading as one repeated field.
 */
function Door({
  index,
  accent,
  mark,
  title,
  blurb,
  placeholder,
  value,
  onChange,
  onSubmit,
  busy,
  label,
  lowercase = false,
  submitLabel,
  submitHint,
  alternates,
}: {
  index: string;
  accent: string;
  mark: React.ReactNode;
  title: string;
  blurb: string;
  placeholder: string;
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  busy: boolean;
  label: string;
  lowercase?: boolean;
  /**
   * Names the primary action where "build me a round" is too vague to pick
   * by — which is any door offering more than one. Only while idle: once a
   * sitting is being read, the shared progress label says the useful thing.
   */
  submitLabel?: string;
  /** One line under the primary saying what it will actually play. */
  submitHint?: string;
  /**
   * Further ways through the same door, after the primary. The Last.fm one
   * runs three difficulties off one username, and a door per difficulty
   * would have meant asking for that username three times.
   */
  alternates?: { label: string; hint?: string; onSubmit: () => void }[];
}) {
  const filled = value.trim().length > 0;
  const primary = busy ? label : (submitLabel ?? label);

  return (
    <section
      style={{ ["--accent" as string]: accent }}
      className="group flex flex-col bg-ink p-6 transition-colors focus-within:bg-ink-raised sm:p-8"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex h-5 items-center">{mark}</div>
        <span className="type-data text-[0.65rem] text-paper-faint">{index}</span>
      </div>

      <h2 className="type-eyebrow mt-8 text-paper">{title}</h2>
      <p className="type-body mt-3 flex-1 text-sm leading-relaxed text-paper-faint">
        {blurb}
      </p>

      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && filled && !busy) onSubmit();
        }}
        placeholder={placeholder}
        disabled={busy}
        autoCapitalize={lowercase ? "none" : undefined}
        autoCorrect={lowercase ? "off" : undefined}
        spellCheck={lowercase ? false : undefined}
        style={{ borderBottomColor: filled ? accent : undefined }}
        className="type-body mt-8 w-full border-b border-ink-edge bg-transparent pb-2 text-sm text-paper placeholder:text-paper-faint focus:outline-none disabled:opacity-50"
      />

      {/*
        One box per way through, stacked, rather than a row of bare words.

        The first version set them as plain text — the primary in the
        accent, the rest underlined — and a reader could not tell they were
        buttons at all. Somebody looking for "records I know" reported not
        being able to press it, took the underlined word beside it for the
        mode he wanted, and played the wrong difficulty without ever
        knowing there had been a choice. Boxes say "press me" without
        having to be told, and stacking them full width makes the target
        the whole row rather than a few characters.

        Each carries a line saying what it actually does, because the names
        alone are the thing that misled: "one step out" from what is only
        obvious once you already know.
      */}
      <div className="mt-6 flex flex-col gap-2">
        {[
          { label: primary, hint: submitHint, onSubmit, lead: true },
          ...(alternates ?? []).map((choice) => ({ ...choice, lead: false })),
        ].map((choice) => {
          const lead = choice.lead && filled && !busy;

          return (
            <button
              key={choice.label}
              type="button"
              onClick={choice.onSubmit}
              disabled={busy || !filled}
              /*
                Hover fills the box in flame rather than nudging its edges.

                The accent border alone was the first attempt and it was too
                quiet — one colour shift on a dark ground, on a screen whose
                whole purpose is these controls. Filling it is the move the
                rest of the app already makes when something is settled: a
                solved answer in `ChoiceField` is flame with ink on top, and
                so is a text selection. Reusing that reads as "this is the
                one" without needing to be learned.

                Flame rather than the door's own accent, so the answer to
                "what am I about to press" looks the same in all three
                columns. The accent still marks the primary at rest, which
                is a different question.

                Classes, not the inline style this used to carry: an inline
                border colour beats every hover rule, so the box could never
                have changed under the cursor.
              */
              className={`group/act flex w-full items-center justify-between gap-3 border px-4 py-3 text-left transition-colors duration-150 enabled:hover:border-flame enabled:hover:bg-flame disabled:opacity-40 ${
                lead ? "border-[var(--accent)]" : "border-ink-edge"
              }`}
            >
              <span className="min-w-0">
                <span className="type-eyebrow block text-xs text-paper transition-colors group-hover/act:text-ink">
                  {choice.label}
                </span>
                {choice.hint && (
                  <span className="type-body mt-1 block text-xs text-paper-faint transition-colors group-hover/act:text-ink/75">
                    {choice.hint}
                  </span>
                )}
              </span>
              <span
                aria-hidden
                className={`type-eyebrow shrink-0 text-xs transition-all duration-150 group-hover/act:translate-x-1 group-hover/act:text-ink ${
                  lead ? "text-[var(--accent)]" : ""
                }`}
              >
                &rarr;
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
