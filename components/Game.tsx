"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReportPanel } from "./ReportPanel";
import { Sleeve } from "./Sleeve";
import { Board } from "./Board";
import { Result } from "./Result";
import { GuessField } from "./GuessField";
import { ChoiceField } from "./ChoiceField";
import { SettingsPanel } from "./SettingsPanel";
import { StatsPanel } from "./StatsPanel";
import { formatSnippet, useSoloAudio } from "@/lib/audio";
import { pickDaily, pickSequential, todayKey } from "@/lib/daily";
import { t } from "@/lib/i18n";
import { ARTISTS, SONGS, buildPool } from "@/lib/lexicon";
import { useConfig, useDailyRecord, usePracticeIndex, useStats } from "@/lib/storage";
import {
  buildShare, createRound, giveUp, missesLeft, openFields,
  recordResult, rungIndex, skipAttempt, submitGuess, unlockedMs,
} from "@/lib/game";
import { activeFields, levelOf } from "@/lib/config";
import type { Field, RoundState, Solo } from "@/lib/types";

/* ------------------------------------------------------------------
   The three questions a record can be asked.

   Everything about a category lives here rather than in the markup, so
   adding a fourth is a matter of one more entry plus its strings.
   ------------------------------------------------------------------ */

const FIELDS = {
  artist: {
    label: "round.artistLabel",
    placeholder: "round.artistPlaceholder",
    solved: "round.artistSolved",
    answer: (solo: Solo) => solo.artist,
  },
  song: {
    label: "round.songLabel",
    placeholder: "round.songPlaceholder",
    solved: "round.songSolved",
    answer: (solo: Solo) => solo.song,
  },
  soloist: {
    label: "round.soloistLabel",
    placeholder: "round.soloistPlaceholder",
    solved: "round.soloistSolved",
    answer: (solo: Solo) => solo.soloist || solo.artist,
  },
} as const;

type Mode = "daily" | "practice";

export function Game({
  solos,
  mode,
  ordered = false,
}: {
  solos: Solo[];
  mode: Mode;
  /**
   * Play the pool in the order it was given, one record per index, instead
   * of picking from it.
   *
   * `pickSequential` derives its running order from the size of the pool,
   * so a pool that grows while somebody is playing gets reshuffled on every
   * arrival and records come round again. A sitting that is still being
   * fetched needs the opposite guarantee: index 3 is the fourth record that
   * arrived and stays the fourth record, whatever lands next.
   */
  ordered?: boolean;
}) {
  const { config, patch, reset, loaded: configLoaded } = useConfig();
  const { stats, setStats, resetStats } = useStats();
  const { record, setRecord, loaded: recordLoaded } = useDailyRecord();

  const { index: practiceIndex, advance: nextPractice } = usePracticeIndex();

  const [panel, setPanel] = useState<"settings" | "stats" | "report" | null>(null);
  const [inputs, setInputs] = useState<Partial<Record<Field, string>>>({});

  const level = levelOf(config);

  // Filtering can empty the pool entirely; falling back beats a blank screen.
  const pool = useMemo(() => {
    const filtered = config.verifiedOnly ? solos.filter((s) => s.verified) : solos;
    return filtered.length > 0 ? filtered : solos;
  }, [solos, config.verifiedOnly]);

  const dateKey = useMemo(() => todayKey(), []);

  const solo = useMemo<Solo | null>(
    () =>
      mode === "daily"
        ? pickDaily(pool, dateKey)
        : ordered
          // Past the end means the next one has not arrived yet, not that
          // it is time to start over.
          ? (pool[practiceIndex] ?? null)
          : pickSequential(pool, practiceIndex),
    [pool, mode, dateKey, practiceIndex, ordered],
  );

  /*
   * A record with no marked solo cannot be asked who is soloing on it.
   * Records fetched without anybody at the screen have only their opening —
   * the TIDAL rounds by design, and an unattended playlist run in passing —
   * so the soloist question is dropped rather than asked about a solo that
   * was never located.
   */
  const fields = useMemo(
    () => activeFields(config).filter((field) => field !== "soloist" || Boolean(solo?.soloAt)),
    [config, solo],
  );

  const [round, setRound] = useState<RoundState | null>(null);
  const recorded = useRef<string | null>(null);
  /** Which round has already been opened, so the restore never runs twice. */
  const openedRound = useRef<string | null>(null);

  const artistRef = useRef<HTMLInputElement>(null);
  const songRef = useRef<HTMLInputElement>(null);
  const soloistRef = useRef<HTMLInputElement>(null);
  const refs: Record<Field, React.RefObject<HTMLInputElement | null>> = {
    artist: artistRef,
    song: songRef,
    soloist: soloistRef,
  };

  /**
   * Open the round: restore today's if there is one, otherwise start fresh.
   *
   * This runs exactly once per round. The guard is not an optimisation — every
   * change to the round is written back to the same stored record this effect
   * reads, so without it the write feeds the read and the two effects push
   * stale state at each other until React gives up.
   */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!solo || !configLoaded) return;
    if (mode === "daily" && !recordLoaded) return;

    const key = `${mode}:${dateKey}:${solo.id}:${config.level}`;
    if (openedRound.current === key) return;
    openedRound.current = key;

    if (mode === "daily" && record?.date === dateKey && record.state.soloId === solo.id) {
      setRound(record.state);
      if (record.state.status !== "playing") recorded.current = solo.id;
      return;
    }

    setRound(createRound(solo.id));
    recorded.current = null;
    setInputs({});
  }, [solo, mode, dateKey, record, recordLoaded, configLoaded, config.level]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /*
   * Which cut of the record is in play. The harder levels open at the solo
   * entry, which is a different file — one that a record may not have been
   * given yet. Falling back to the head clip keeps every record playable at
   * every level; it only makes the hard ones easier than they should be.
   */
  const clip = useMemo(() => {
    if (!solo) return null;
    if (level.start === "solo" && solo.soloClip) return solo.soloClip;
    return { audio: solo.audio, leadIn: solo.leadIn, clipDuration: solo.clipDuration };
  }, [solo, level.start]);

  const audio = useSoloAudio(clip?.audio ?? null, config.volume);

  const revealed = round?.status === "won" || round?.status === "lost";

  /**
   * When the round became revealed, so Enter can refuse to act on it for a
   * moment.
   *
   * `event.repeat` catches a key literally held too long, but not a second,
   * genuine press thrown in out of habit — someone used to pressing Enter
   * twice to be sure, arriving a beat after the first already solved the
   * round. Nothing distinguishes that keydown from a deliberate "move on"
   * except how soon it lands after the reveal, so revealed gets a short
   * window where it plainly refuses to mean anything yet.
   */
  const revealedAt = useRef<number | null>(null);
  useEffect(() => {
    revealedAt.current = revealed ? Date.now() : null;
  }, [revealed, round?.soloId]);

  /**
   * Where the playhead sits inside the solo, in milliseconds.
   *
   * Every playback restarts at the solo entry, so this always climbs from
   * zero — which is what lets the strip replay the ground already covered
   * instead of animating the newest rung in isolation. Any lead-in is
   * subtracted, because it sounds before the solo rather than inside it.
   */
  const playheadMs = useMemo(() => {
    if (!audio.isPlaying || !clip || !round) return null;

    if (revealed) {
      return audio.progress * (clip.clipDuration - clip.leadIn) * 1000;
    }

    const leadMs = Math.min(config.leadInMs, clip.leadIn * 1000);
    const totalMs = leadMs + unlockedMs(round, config);
    return Math.max(0, audio.progress * totalMs - leadMs);
  }, [audio.isPlaying, audio.progress, clip, round, revealed, config]);

  const play = useCallback(() => {
    if (!clip || !round) return;
    if (audio.isPlaying) {
      audio.stop();
      return;
    }

    if (revealed) {
      audio.play(clip.leadIn, clip.clipDuration - clip.leadIn);
      return;
    }

    const lead = config.leadInMs / 1000;
    const offset = Math.max(0, clip.leadIn - lead);
    const duration = (clip.leadIn - offset) + unlockedMs(round, config) / 1000;
    audio.play(offset, duration);
  }, [clip, round, audio, revealed, config]);

  // Persist the daily round after every change to it.
  useEffect(() => {
    if (mode !== "daily" || !round || !recordLoaded) return;
    if (round.attempts.length === 0 && round.rung === 0) return;
    setRecord({ date: dateKey, state: round });
  }, [round, mode, dateKey, recordLoaded, setRecord]);

  // Fold a finished round into the stats exactly once.
  useEffect(() => {
    if (!round || !solo || round.status === "playing") return;
    if (recorded.current === solo.id) return;
    recorded.current = solo.id;
    setStats((current) =>
      recordResult(current, round, config, mode === "daily" ? dateKey : null),
    );
  }, [round, solo, mode, dateKey, config, setStats]);

  const artistPool = useMemo(
    () => buildPool(ARTISTS, solos.map((s) => s.artist)),
    [solos],
  );
  const songPool = useMemo(() => buildPool(SONGS, solos.map((s) => s.song)), [solos]);
  /*
   * Everyone the library has ever credited, plus the wider artist lexicon.
   * The people who play on these records are largely the people who lead
   * them, so no separate list of sidemen has to be kept anywhere.
   *
   * The named soloists go in alongside the credits. A soloist typed by hand
   * on the marking screen need not appear in anybody's personnel list, and
   * an answer the game will accept but never suggest is the one gap this
   * pool must not have.
   */
  const soloistPool = useMemo(
    () =>
      buildPool(ARTISTS, [
        ...solos.flatMap((s) => s.personnel.map((credit) => credit.name)),
        ...solos.map((s) => s.soloist),
      ]),
    [solos],
  );
  const pools: Record<Field, string[]> = {
    artist: artistPool,
    song: songPool,
    soloist: soloistPool,
  };

  const open = round ? openFields(round, config) : [];
  const hasGuess = open.some((field) => (inputs[field] ?? "").trim());

  /**
   * Check one or more categories.
   *
   * Each is scored on its own: a right answer locks its field and leaves the
   * ladder alone, a wrong one buys the next rung. Folding them through the
   * reducer in order means checking two at once costs exactly what checking
   * them one after the other would have.
   *
   * The override exists because picking a suggestion and submitting are one
   * keystroke, not two — setState from the same field is batched, so reading
   * `inputs` back immediately afterward would see the value from before this
   * keystroke.
   */
  const guess = useCallback(
    (entries: { field: Field; value: string }[]) => {
      if (!round || !solo) return;
      const filled = entries.filter(
        (entry) => entry.value.trim() && !round.solved.includes(entry.field),
      );
      if (filled.length === 0) return;

      let next = round;
      for (const entry of filled) {
        next = submitGuess(next, solo, entry.field, entry.value, config);
      }
      setRound(next);

      setInputs((current) => {
        const updated = { ...current };
        for (const entry of filled) {
          updated[entry.field] = next.solved.includes(entry.field) ? entry.value : "";
        }
        return updated;
      });

      // Put the caret on whichever question is still open.
      queueMicrotask(() => {
        const still = openFields(next, config);
        if (still.length > 0) refs[still[0]].current?.focus();
      });
    },
    // refs holds three stable useRef objects; rebuilding the wrapper each
    // render does not change what they point at.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [round, solo, config],
  );

  const guessField = useCallback(
    (field: Field, overrideValue?: string) =>
      guess([{ field, value: overrideValue ?? inputs[field] ?? "" }]),
    [guess, inputs],
  );

  /** Pass on the question at the top of the list. */
  const skip = useCallback(() => {
    if (!round) return;
    const [first] = openFields(round, config);
    if (!first) return;
    audio.stop();
    setRound(skipAttempt(round, first, config));
  }, [round, audio, config]);

  /**
   * One action rather than two.
   *
   * Two buttons side by side meant typing an answer and then throwing it away
   * by pressing the wrong one. So the control follows the fields: with
   * something in them it checks everything that has been typed, with nothing
   * in them it passes on the question at the top.
   */
  const submit = useCallback(() => {
    if (!round) return;
    const entries = openFields(round, config)
      .map((field) => ({ field, value: inputs[field] ?? "" }))
      .filter((entry) => entry.value.trim());

    if (entries.length > 0) guess(entries);
    else skip();
  }, [round, config, inputs, guess, skip]);

  /**
   * Keyboard control.
   *
   * The guess fields hold focus for most of a round, so a bare letter would be
   * unusable as a shortcut. Space is therefore ignored while typing — Enter and
   * Shift+Enter are the two that have to work from inside a field, and they do.
   *
   * An empty field is the exception: focusing a field and immediately hitting
   * space is a far more common way to ask for the audio than to type a
   * leading space, so an empty input treats space as play rather than as a
   * character. The moment there is a single character in it, space types
   * normally again.
   */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (panel) return; // the open overlay owns the keyboard

      /*
       * A key held a moment too long fires again as an OS auto-repeat, and
       * that second keydown can land after this exact press already changed
       * what is on screen — solving the last field unmounts the guess
       * fields, so the repeat lands on <body> rather than the field it
       * started in. Read there, "Enter" no longer looks like it came from a
       * field, and on the result screen that means it is taken as a second,
       * deliberate press asking to move on — skipping the result before it
       * was ever seen. A single physical press must never do that.
       */
      if (event.repeat) return;

      const target = event.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      // An empty field only changes what space does. Enter still belongs to
      // the field itself when one is focused — GuessField's own handler
      // already calls submit() in that case, and treating typing as false
      // here as well would fire it a second time on the way to window.
      if (event.key === " ") {
        const fieldIsEmpty = typing && (target as HTMLInputElement).value === "";
        if (!typing || fieldIsEmpty) {
          event.preventDefault();
          play();
        }
        return;
      }

      if (event.key !== "Enter") return;

      if (event.shiftKey) {
        event.preventDefault();
        if (!revealed) skip();
        return;
      }

      if (revealed) {
        // Won't be argued past for a quarter second — long enough that only
        // a keypress meant for the result screen itself lands after it.
        const justNow = revealedAt.current !== null && Date.now() - revealedAt.current < 250;
        if (mode === "practice" && !justNow) {
          event.preventDefault();
          nextPractice();
        }
        return;
      }

      // A field with an open suggestion list handles its own Enter.
      if (!typing) {
        event.preventDefault();
        submit();
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel, play, skip, submit, revealed, mode, nextPractice]);

  if (!solo || !round) {
    return <EmptyState hasSolos={solos.length > 0} />;
  }

  const share = buildShare(round, solo, config, mode === "daily" ? dateKey : null);
  const left = missesLeft(round, config);
  /* Values already tried and wrong, so a multiple-choice option can be
     struck out rather than silently accepted a second time. */
  const rejected = (field: Field) =>
    round.attempts
      .filter((attempt) => attempt.field === field && !attempt.correct && attempt.value)
      .map((attempt) => attempt.value as string);

  return (
    <div className="flex min-h-screen flex-col">
      <Header catalog={solo.catalog} onOpen={setPanel} />

      <main className="grid flex-1 grid-cols-1 lg:grid-cols-[1.05fr_1fr]">
        <section className="border-b border-ink-edge lg:border-b-0 lg:border-r">
          <Sleeve
            solo={solo}
            ladderMs={config.ladderMs}
            rung={rungIndex(round, config)}
            revealed={revealed}
            playing={audio.isPlaying}
            progress={audio.progress}
            playheadMs={playheadMs}
            onPlay={play}
            audioReady={audio.status === "ready"}
            audioFailed={audio.status === "error"}
            onReport={() => setPanel("report")}
          />
        </section>

        <section className="p-6 sm:p-10 lg:p-14">
          {revealed ? (
            <Result
              solo={solo}
              state={round}
              heardMs={unlockedMs(round, config)}
              share={share}
              isDaily={mode === "daily"}
              onPlayFull={play}
              onNext={mode === "practice" ? nextPractice : undefined}
              keysHint={t(mode === "practice" ? "round.keysHintNext" : "round.keysHintRevealed")}
            />
          ) : (
            <>
              <div className="flex items-baseline justify-between gap-4">
                <span className="type-eyebrow text-paper-faint">
                  {level.label}
                </span>
                <span className="type-data text-xs text-paper-faint">
                  {formatSnippet(unlockedMs(round, config))}
                </span>
              </div>

              <div className="mt-6 space-y-5">
                {fields.map((field) => {
                  const copy = FIELDS[field];
                  const answer = copy.answer(solo);

                  return level.choice.includes(field) ? (
                    <ChoiceField
                      key={field}
                      label={t(copy.label)}
                      seed={solo.id}
                      answer={answer}
                      pool={pools[field]}
                      onPick={(value) => guess([{ field, value }])}
                      rejected={rejected(field)}
                      solved={round.solved.includes(field)}
                      solvedLabel={t(copy.solved)}
                    />
                  ) : (
                    <GuessField
                      key={field}
                      label={t(copy.label)}
                      placeholder={t(copy.placeholder)}
                      pool={pools[field]}
                      value={inputs[field] ?? ""}
                      onChange={(value) =>
                        setInputs((current) => ({ ...current, [field]: value }))
                      }
                      onSubmit={(overrideValue) => guessField(field, overrideValue)}
                      solved={round.solved.includes(field)}
                      solvedLabel={t(copy.solved)}
                      solvedValue={answer}
                      inputRef={refs[field]}
                    />
                  );
                })}
              </div>

              <button
                type="button"
                onClick={submit}
                className={`type-eyebrow mt-7 w-full px-5 py-4 transition-colors duration-150 ${
                  hasGuess
                    ? "bg-flame text-ink hover:bg-paper"
                    : "border border-ink-edge text-paper-dim hover:border-paper-faint hover:text-paper"
                }`}
              >
                {hasGuess ? t("round.submit") : t("round.skip")}
              </button>

              <p className="type-data mt-3 text-xs text-paper-faint">
                {t("round.keysHint")}
              </p>

              <p className="type-data mt-3 text-xs text-paper-faint">
                {t("round.missesLeft", { n: left })}
                {" · "}
                <button
                  type="button"
                  onClick={() => setRound(giveUp(round, config))}
                  className="underline underline-offset-2 transition-colors hover:text-flame"
                >
                  {t("round.giveUp")}
                </button>
              </p>

              <div className="mt-10">
                <Board attempts={round.attempts} missesLeft={left} />
              </div>
            </>
          )}
        </section>
      </main>

      {panel === "settings" && (
        <SettingsPanel
          config={config}
          onPatch={patch}
          onReset={reset}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === "stats" && (
        <StatsPanel
          stats={stats}
          ladderMs={config.ladderMs}
          onReset={resetStats}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === "report" && (
        <ReportPanel soloId={solo.id} onClose={() => setPanel(null)} />
      )}
    </div>
  );
}

function Header({
  catalog, onOpen,
}: {
  catalog: string;
  onOpen: (panel: "settings" | "stats") => void;
}) {
  /*
   * Which link is lit follows the address, not the mode. A sitting built
   * from somebody's taste runs in practice mode, so keying off the mode
   * would light "practice" while they are somewhere else entirely.
   */
  const path = usePathname();

  return (
    <header className="flex flex-wrap items-center gap-x-8 gap-y-3 border-b border-ink-edge px-6 py-4 sm:px-10 lg:px-14">
      <Link href="/" className="flex items-center gap-3">
        <span className="block h-4 w-4 bg-flame" aria-hidden="true" />
        <span className="type-display text-xl text-paper">{t("brand")}</span>
      </Link>

      <nav className="flex gap-6">
        <NavLink href="/" active={path === "/"}>{t("nav.daily")}</NavLink>
        <NavLink href="/practice" active={path === "/practice"}>{t("nav.practice")}</NavLink>
        <NavLink href="/for-you" active={path === "/for-you"}>{t("nav.forYou")}</NavLink>
        <NavLink href="/suggest" active={path === "/suggest"}>{t("nav.suggest")}</NavLink>
      </nav>

      <div className="ml-auto flex items-center gap-5">
        <span className="type-data hidden text-xs text-paper-faint sm:block">{catalog}</span>
        <button type="button" onClick={() => onOpen("stats")} className="type-eyebrow text-paper-dim transition-colors hover:text-flame">
          {t("nav.stats")}
        </button>
        <button type="button" onClick={() => onOpen("settings")} className="type-eyebrow text-paper-dim transition-colors hover:text-flame">
          {t("nav.settings")}
        </button>
      </div>
    </header>
  );
}

function NavLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`type-eyebrow border-b-2 pb-[2px] transition-colors duration-150 ${
        active ? "border-flame text-paper" : "border-transparent text-paper-dim hover:text-paper"
      }`}
    >
      {children}
    </Link>
  );
}

function EmptyState({ hasSolos }: { hasSolos: boolean }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-10">
      <div className="max-w-lg">
        <span className="type-eyebrow text-flame">{t("brand")}</span>
        <h1 className="type-display-tight mt-4 text-5xl text-paper">Nothing to play</h1>
        <p className="type-body mt-4 text-paper-dim">
          {hasSolos
            ? "Every solo is filtered out by the current settings."
            : t("library.empty")}
        </p>
        <Link
          href="/suggest"
          className="type-eyebrow mt-8 inline-block bg-flame px-5 py-3 text-ink transition-colors hover:bg-paper"
        >
          {t("nav.suggest")}
        </Link>
      </div>
    </div>
  );
}
