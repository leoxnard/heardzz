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

/**
 * The doors somebody has actually been through, most recent first, kept
 * apart from the sitting above because it outlives it: a sitting is over
 * when you leave it, and the link you pasted to build it is worth having
 * tomorrow. Nothing here leaves the browser.
 */
const HISTORY_STORAGE_KEY = "heardzz:foryou:history:v1";

/** Long enough to find last week's playlist, short enough to read at a glance. */
const HISTORY_KEPT = 6;

interface Past {
  /** Which door it was typed into: the key `READINGS` is indexed by. */
  door: string;
  /** Exactly what was typed — a link, a username, a few words. */
  value: string;
  /** Which reading of it was played. */
  mode: string;
  /** What the round turned out to be, in TIDAL's or Last.fm's own words. */
  source: string;
  at: number;
}

/**
 * The two readings each door offers, named so the name is the whole
 * explanation.
 *
 * Held here rather than inside the three `Door` calls because the history
 * below needs them too — a row saying only "hard bop" cannot say which of
 * the two ways through it was played, and a second copy of these labels
 * would be a second thing to keep in step.
 */
const READINGS: Record<string, { key: string; label: string }[]> = {
  lastfm: [
    { key: "known", label: "Records I know" },
    { key: "nearby", label: "Records like mine" },
  ],
  tidal: [
    { key: "inside", label: "Records from it" },
    { key: "wider", label: "Records like it" },
  ],
  words: [
    { key: "exact", label: "Exactly that" },
    { key: "wider", label: "Records like it" },
  ],
};

/** What to call each door in a history row, where its mark is not there to say. */
const DOOR_NAMES: Record<string, string> = {
  lastfm: "Last.fm",
  tidal: "TIDAL",
  words: "Typed",
};

/** "yesterday", "3 days ago" — near enough, and shorter than a date. */
function ago(at: number): string {
  const days = Math.floor((Date.now() - at) / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months === 1 ? "a month ago" : `${months} months ago`;
}

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
  /**
   * The message and the door it belongs to. Which door matters: three
   * panels sit side by side, and a line under all of them saying "couldn't
   * place that" names no field to go and fix.
   */
  const [error, setError] = useState<{ door: string; message: string } | null>(null);
  /**
   * The door a sitting is being read through, or null.
   *
   * Progress used to be handed to all three at once — every door reading
   * "Fetching (0 ready)" while one of them was working, which said that
   * pressing any of them had started something. Only the one that was
   * pressed says anything now; the other two are simply out of reach until
   * it is done.
   */
  const [activeDoor, setActiveDoor] = useState<string | null>(null);
  /** Doors gone through before, read from storage at mount. */
  const [history, setHistory] = useState<Past[]>([]);
  /**
   * The reading marked in each door, or null where none is yet.
   *
   * Held here rather than inside the doors because a history row sets one
   * from outside: pressing "Moonchild — records from it" fills that door's
   * field and must mark that door's box too, or the round would be running
   * against a panel that says nothing was chosen.
   */
  const [picks, setPicks] = useState<Record<string, string | null>>({});
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

  /**
   * Write down a door that worked, so tomorrow it is one press away.
   *
   * Only on the way out of a successful read: a link that was refused, or a
   * username with a typo in it, is not a place anybody wants taken back to.
   * The same words typed twice move to the top rather than appearing twice.
   */
  const remember = useCallback((seen: Omit<Past, "at">) => {
    const entry: Past = { ...seen, at: Date.now() };
    setHistory((past) => {
      const key = `${entry.door}|${entry.mode}|${entry.value.toLowerCase()}`;
      const next = [
        entry,
        ...past.filter(
          (old) => `${old.door}|${old.mode}|${old.value.toLowerCase()}` !== key,
        ),
      ].slice(0, HISTORY_KEPT);

      try {
        window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Then it lasts as long as the tab does, which is still better than nothing.
      }
      return next;
    });
  }, []);

  /** Clear it out. Somebody else's turn at the keyboard, usually. */
  function forget() {
    setHistory([]);
    try {
      window.localStorage.removeItem(HISTORY_STORAGE_KEY);
    } catch {
      // Already gone from the screen, which is what was asked for.
    }
  }

  /** Pick up a sitting left mid-play, rather than starting the listener over. */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(HISTORY_STORAGE_KEY);
      if (stored) {
        const past = JSON.parse(stored) as Past[];
        // Anything that does not name a door this build still has is from an
        // older shape of this list, and is dropped rather than rendered blank.
        if (Array.isArray(past)) {
          setHistory(past.filter((entry) => entry?.value && READINGS[entry.door]));
        }
      }
    } catch {
      // A history that cannot be read is no worse than no history.
    }

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
  async function beginSession(
    request: () => Promise<Response>,
    resolvedTarget: string,
    /** Which door, and what was typed into it — the makings of a history row. */
    through: { door: string; value: string; mode: string },
  ) {
    if (running.current) return;
    running.current = true;
    const { door } = through;
    const mine = (sitting.current += 1);
    setActiveDoor(door);
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
      // Only now: a door is worth writing down once it has answered.
      remember({ ...through, source: data.source ?? "" });
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
      setError({
        door,
        message: cause instanceof Error ? cause.message : "Could not read that",
      });
    } finally {
      running.current = false;
    }
  }

  /**
   * A pasted link, read one of two ways.
   *
   * "inside" plays what is on the list — or, for an artist link, what that
   * artist recorded. "wider" reads it for who is on it and widens to
   * artists who sound like them, which is the right reading for somebody
   * handing over a playlist as a description of their taste rather than as
   * a set of questions.
   */
  function start(mode: "inside" | "wider", raw = target) {
    const trimmed = raw.trim();
    void beginSession(
      () =>
        fetch("/api/foryou/plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target: trimmed, mode }),
        }),
      trimmed,
      { door: "tidal", value: trimmed, mode },
    );
  }

  /**
   * The same sitting again, built from a few words instead of a link, and
   * read the same two ways the link door reads a link.
   *
   * "exact" takes the words at their word: an artist's catalogue if they
   * are a name, a tag's best-known records if they are a genre — see
   * `/api/foryou/from-text`, which tries both and needs no model for
   * either. "wider" hands them to one, which names artists out of whatever
   * was said and widens from those.
   */
  function startFromWords(mode: "exact" | "wider", raw = words) {
    const trimmed = raw.trim();
    void beginSession(
      () =>
        fetch("/api/foryou/from-text", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: trimmed, ...(mode === "exact" ? { mode } : {}) }),
        }),
      "",
      { door: "words", value: trimmed, mode },
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
  function startFromLastfm(mode: "known" | "nearby", raw = listener) {
    const trimmed = raw.trim();
    void beginSession(
      () =>
        fetch("/api/foryou/lastfm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user: trimmed, mode }),
        }),
      "",
      { door: "lastfm", value: trimmed, mode },
    );
  }

  /**
   * Go back through a door that worked before.
   *
   * The field is filled in as well as played, so the row that was pressed
   * is visibly where the round came from — and so the other reading of the
   * same words is one press away rather than a retype. The value is passed
   * to the start alongside, because setting state does not make it readable
   * on this pass.
   */
  function replay(entry: Past) {
    if (busy) return;
    setPicks((marked) => ({ ...marked, [entry.door]: entry.mode }));
    if (entry.door === "lastfm") {
      setListener(entry.value);
      startFromLastfm(entry.mode as "known" | "nearby", entry.value);
    } else if (entry.door === "tidal") {
      setTarget(entry.value);
      start(entry.mode as "inside" | "wider", entry.value);
    } else {
      setWords(entry.value);
      startFromWords(entry.mode as "exact" | "wider", entry.value);
    }
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
    setPicks({});
    setSource("");
    setReached([]);
    setSolos([]);
    setReady(0);
    setPlayed(0);
    setRemaining(0);
    setError(null);
    setActiveDoor(null);
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
  /*
   * What the working door says while it works. Only that one: the other two
   * get `null` and stay quiet.
   */
  const status =
    phase === "planning"
      ? "Reading your taste"
      : phase === "fetching"
        ? `Fetching (${ready} ready)`
        : null;

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
          blurb="Your Last.fm username, or your profile link."
          placeholder="your last.fm username"
          value={listener}
          onChange={setListener}
          lowercase
          choices={READINGS.lastfm}
          picked={picks.lastfm ?? null}
          onPick={(key) => setPicks((marked) => ({ ...marked, lastfm: key }))}
          onStart={(key) => startFromLastfm(key as "known" | "nearby")}
          busy={busy}
          status={activeDoor === "lastfm" ? status : null}
          error={error?.door === "lastfm" ? error.message : null}
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
          title="A playlist or an artist"
          blurb="Paste a public TIDAL playlist, artist or track link."
          placeholder="tidal.com/playlist/… or /artist/…"
          value={target}
          onChange={setTarget}
          choices={READINGS.tidal}
          picked={picks.tidal ?? null}
          onPick={(key) => setPicks((marked) => ({ ...marked, tidal: key }))}
          onStart={(key) => start(key as "inside" | "wider")}
          busy={busy}
          status={activeDoor === "tidal" ? status : null}
          error={error?.door === "tidal" ? error.message : null}
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
          blurb="An artist, or a genre — whichever you type."
          placeholder="Michael Brecker, or hard bop"
          value={words}
          onChange={setWords}
          choices={READINGS.words}
          picked={picks.words ?? null}
          onPick={(key) => setPicks((marked) => ({ ...marked, words: key }))}
          onStart={(key) => startFromWords(key as "exact" | "wider")}
          busy={busy}
          status={activeDoor === "words" ? status : null}
          error={error?.door === "words" ? error.message : null}
        />
      </div>

      {reached.length > 0 && (
        <p className="type-body mt-6 text-xs leading-relaxed text-paper-faint">
          Reaching for {reached.join(", ")}.
        </p>
      )}

      {/*
        What has been through here before.

        A playlist link is not something anybody has memorised, and having
        pasted one once is no help a week later — the round it built is over
        and the link went with it. So the doors that worked are kept, and
        each is one press from being played again, at the reading it was
        played at.
      */}
      {history.length > 0 && (
        <div className="mt-16 border-t border-ink-edge pt-6">
          <div className="flex items-baseline justify-between gap-4">
            <p className="type-eyebrow text-paper-faint">Been here before</p>
            <button
              type="button"
              onClick={forget}
              className="type-eyebrow text-xs text-paper-faint transition-colors hover:text-flame"
            >
              Forget these
            </button>
          </div>

          <ul className="mt-4 flex flex-col">
            {history.map((entry) => {
              const reading =
                READINGS[entry.door]?.find((choice) => choice.key === entry.mode)?.label
                ?? entry.mode;

              return (
                <li key={`${entry.door}|${entry.mode}|${entry.value}`}>
                  <button
                    type="button"
                    onClick={() => replay(entry)}
                    disabled={busy}
                    className="group/past flex w-full items-baseline gap-4 border-b border-ink-edge py-3 text-left transition-colors hover:border-flame disabled:opacity-40"
                  >
                    <span className="type-data w-16 shrink-0 text-[0.65rem] text-paper-faint">
                      {DOOR_NAMES[entry.door]}
                    </span>
                    {/*
                      What the round turned out to be, where the round knows
                      — "Dexter Gordon" rather than a thirty-character id.
                      The link itself when it does not, which is every
                      reading that never named its source.
                    */}
                    <span className="type-body min-w-0 flex-1 truncate text-sm text-paper transition-colors group-hover/past:text-flame">
                      {entry.source || entry.value}
                    </span>
                    <span className="type-eyebrow shrink-0 text-[0.65rem] text-paper-faint">
                      {reading}
                    </span>
                    <span className="type-body hidden shrink-0 text-xs text-paper-faint sm:block">
                      {ago(entry.at)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
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
  choices,
  picked,
  onPick,
  onStart,
  busy,
  status,
  error,
  lowercase = false,
}: {
  index: string;
  accent: string;
  mark: React.ReactNode;
  title: string;
  blurb: string;
  placeholder: string;
  value: string;
  onChange: (next: string) => void;
  /**
   * The readings this door offers, named so the name is the whole
   * explanation. They used to carry a line of hint each — "harder: records
   * next to yours, which you have not played" — and three columns of that
   * is more prose than anybody reads standing at a choice. A name that
   * needs a gloss is the wrong name.
   */
  choices: { key: string; label: string }[];
  /*
   * Picking is not starting.
   *
   * Every box used to fire its round on the first click, which made the
   * three of them three buttons that looked like options — no way to see
   * what you had chosen, no way to change your mind, and a download started
   * by a click meant as a read. So a click marks the box instead, and the
   * button below commits it. Which one is marked is the parent's to hold,
   * since the history list marks one from outside.
   */
  picked: string | null;
  onPick: (key: string) => void;
  onStart: (key: string) => void;
  /** Some door is working: no other one may be started over it. */
  busy: boolean;
  /** What this door is doing, if it is the one working. Null otherwise. */
  status: string | null;
  /** What went wrong here, if anything did. */
  error: string | null;
  lowercase?: boolean;
}) {
  const filled = value.trim().length > 0;
  const ready = filled && picked !== null && !busy;

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
      {/* Takes the slack, so a blurb that wraps to two lines in one column
          does not push that column's field and boxes out of line with the
          other two — the three sets of controls sit level whatever the
          prose above them does. */}
      <p className="type-body mt-3 flex-1 text-sm leading-relaxed text-paper-faint">{blurb}</p>

      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && ready) onStart(picked);
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
        The readings, one compact box each, directly under the field they
        read. A chosen one is filled in flame with ink on top — the move
        the rest of the app already makes for something settled, in
        `ChoiceField` and in a text selection — so "which one did I pick"
        is answerable across the room rather than by reading three borders.

        The button below commits whichever is marked, and is dead until one
        is.
      */}
      <div className="mt-6 flex flex-col gap-2">
        {choices.map((choice) => {
          const chosen = picked === choice.key;

          return (
            <button
              key={choice.key}
              type="button"
              aria-pressed={chosen}
              onClick={() => onPick(choice.key)}
              disabled={busy}
              className={`type-eyebrow w-full border px-4 py-2.5 text-left text-xs transition-colors duration-150 disabled:opacity-40 ${
                chosen
                  ? "border-flame bg-flame text-ink"
                  : "border-ink-edge text-paper enabled:hover:border-flame"
              }`}
            >
              {choice.label}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => picked && onStart(picked)}
        disabled={!ready}
        /*
          Dead until there is something to start: a field with something in
          it and a reading chosen. Saying so by going flat and unreachable
          is quieter than an explanation of what is missing, and the two
          things missing are both on screen directly above it.

          Paper rather than the door's own accent, and rather than the flame
          the marked box carries: the choice above and the commit below must
          not look like the same control twice, and on the third door — whose
          accent is flame — they would have been exactly that.
        */
        className={`type-eyebrow mt-3 w-full px-4 py-3 text-center text-xs transition-colors duration-150 ${
          ready
            ? "bg-paper text-ink hover:bg-flame"
            : "cursor-not-allowed border border-ink-edge text-paper-faint"
        }`}
      >
        {status ?? "Start"}
      </button>

      {error && (
        <p className="type-body mt-3 text-xs leading-relaxed text-flame">{error}</p>
      )}
    </section>
  );
}
