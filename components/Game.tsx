"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Sleeve } from "./Sleeve";
import { Board } from "./Board";
import { Result } from "./Result";
import { GuessField } from "./GuessField";
import { SettingsPanel } from "./SettingsPanel";
import { StatsPanel } from "./StatsPanel";
import { formatSnippet, useSoloAudio } from "@/lib/audio";
import { pickDaily, pickSequential, todayKey } from "@/lib/daily";
import { t } from "@/lib/i18n";
import { ARTISTS, SONGS, buildPool } from "@/lib/lexicon";
import { useConfig, useDailyRecord, usePracticeIndex, useStats } from "@/lib/storage";
import {
  attemptsLeft, buildShare, createRound, giveUp, recordResult,
  rungIndex, skipAttempt, submitGuess, unlockedMs,
} from "@/lib/game";
import type { RoundState, Solo } from "@/lib/types";

type Mode = "daily" | "practice";

export function Game({ solos, mode }: { solos: Solo[]; mode: Mode }) {
  const { config, patch, reset, loaded: configLoaded } = useConfig();
  const { stats, setStats, resetStats } = useStats();
  const { record, setRecord, loaded: recordLoaded } = useDailyRecord();

  const { index: practiceIndex, advance: nextPractice } = usePracticeIndex();

  const [panel, setPanel] = useState<"settings" | "stats" | null>(null);
  const [artistInput, setArtistInput] = useState("");
  const [songInput, setSongInput] = useState("");

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
        : pickSequential(pool, practiceIndex),
    [pool, mode, dateKey, practiceIndex],
  );

  const [round, setRound] = useState<RoundState | null>(null);
  const recorded = useRef<string | null>(null);
  /** Which round has already been opened, so the restore never runs twice. */
  const openedRound = useRef<string | null>(null);

  const artistRef = useRef<HTMLInputElement>(null);
  const songRef = useRef<HTMLInputElement>(null);

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

    const key = `${mode}:${dateKey}:${solo.id}`;
    if (openedRound.current === key) return;
    openedRound.current = key;

    if (mode === "daily" && record?.date === dateKey && record.state.soloId === solo.id) {
      setRound(record.state);
      if (record.state.status !== "playing") recorded.current = solo.id;
      return;
    }

    setRound(createRound(solo.id));
    recorded.current = null;
    setArtistInput("");
    setSongInput("");
  }, [solo, mode, dateKey, record, recordLoaded, configLoaded]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const audio = useSoloAudio(solo?.audio ?? null, config.volume);

  const revealed = round?.status === "won" || round?.status === "lost";

  /**
   * Where the playhead sits inside the solo, in milliseconds.
   *
   * Every playback restarts at the solo entry, so this always climbs from
   * zero — which is what lets the strip replay the ground already covered
   * instead of animating the newest rung in isolation. Any lead-in is
   * subtracted, because it sounds before the solo rather than inside it.
   */
  const playheadMs = useMemo(() => {
    if (!audio.isPlaying || !solo || !round) return null;

    if (revealed) {
      return audio.progress * (solo.clipDuration - solo.leadIn) * 1000;
    }

    const leadMs = Math.min(config.leadInMs, solo.leadIn * 1000);
    const totalMs = leadMs + unlockedMs(round, config);
    return Math.max(0, audio.progress * totalMs - leadMs);
  }, [audio.isPlaying, audio.progress, solo, round, revealed, config]);

  const play = useCallback(() => {
    if (!solo || !round) return;
    if (audio.isPlaying) {
      audio.stop();
      return;
    }

    if (revealed) {
      audio.play(solo.leadIn, solo.clipDuration - solo.leadIn);
      return;
    }

    const lead = config.leadInMs / 1000;
    const offset = Math.max(0, solo.leadIn - lead);
    const duration = (solo.leadIn - offset) + unlockedMs(round, config) / 1000;
    audio.play(offset, duration);
  }, [solo, round, audio, revealed, config]);

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
    setStats((current) => recordResult(current, round, mode === "daily" ? dateKey : null));
  }, [round, solo, mode, dateKey, setStats]);

  const artistPool = useMemo(
    () => buildPool(ARTISTS, solos.map((s) => s.artist)),
    [solos],
  );
  const songPool = useMemo(() => buildPool(SONGS, solos.map((s) => s.song)), [solos]);

  const hasGuess = Boolean(artistInput.trim() || songInput.trim());

  const guess = useCallback(() => {
    if (!round || !solo) return;
    if (!artistInput.trim() && !songInput.trim()) return;
    const next = submitGuess(round, solo, { artist: artistInput, song: songInput }, config);
    setRound(next);
    if (!next.artistSolved) setArtistInput("");
    if (!next.songSolved) setSongInput("");

    // Put the caret back on whichever half is still open.
    queueMicrotask(() => {
      if (!next.artistSolved) artistRef.current?.focus();
      else if (config.guessSong && !next.songSolved) songRef.current?.focus();
    });
  }, [round, solo, artistInput, songInput, config]);

  const skip = useCallback(() => {
    if (!round) return;
    audio.stop();
    setRound(skipAttempt(round, config));
  }, [round, audio, config]);

  /**
   * One action rather than two.
   *
   * Guessing and skipping both spend an attempt and both unlock the next
   * rung; the only difference is whether what you typed is recorded. Two
   * buttons side by side meant typing an answer and then throwing it away by
   * pressing the wrong one. So the control follows the fields: with something
   * in them it guesses, with nothing in them it skips.
   */
  const submit = useCallback(() => {
    if (artistInput.trim() || songInput.trim()) guess();
    else skip();
  }, [artistInput, songInput, guess, skip]);

  /**
   * Keyboard control.
   *
   * The guess fields hold focus for most of a round, so a bare letter would be
   * unusable as a shortcut. Space is therefore ignored while typing — Enter and
   * Shift+Enter are the two that have to work from inside a field, and they do.
   */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (panel) return; // the open overlay owns the keyboard

      const target = event.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      if (event.key === " " && !typing) {
        event.preventDefault();
        play();
        return;
      }

      if (event.key !== "Enter") return;

      if (event.shiftKey) {
        event.preventDefault();
        if (!revealed) skip();
        return;
      }

      if (revealed) {
        if (mode === "practice") {
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
  const left = attemptsLeft(round, config);

  return (
    <div className="flex min-h-screen flex-col">
      <Header
        mode={mode}
        catalog={solo.catalog}
        onOpen={setPanel}
      />

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
          />
          {audio.status === "error" && (
            <p className="type-body px-6 pb-6 text-sm text-flame sm:px-10 lg:px-14">
              Audio for {solo.catalog} could not be loaded. The file may be missing from
              public{solo.audio} — re-run it through the library screen.
            </p>
          )}
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
                  {t("round.attemptOf", {
                    n: round.attempts.length + 1,
                    total: config.ladderMs.length,
                  })}
                </span>
                <span className="type-data text-xs text-paper-faint">
                  {formatSnippet(unlockedMs(round, config))}
                </span>
              </div>

              <div className="mt-6 space-y-5">
                <GuessField
                  label={t("round.artistLabel")}
                  placeholder={t("round.artistPlaceholder")}
                  pool={artistPool}
                  value={artistInput}
                  onChange={setArtistInput}
                  onSubmit={guess}
                  solved={round.artistSolved}
                  solvedLabel={t("round.artistSolved")}
                  solvedValue={solo.artist}
                  inputRef={artistRef}
                />

                {config.guessSong && (
                  <GuessField
                    label={t("round.songLabel")}
                    placeholder={t("round.songPlaceholder")}
                    pool={songPool}
                    value={songInput}
                    onChange={setSongInput}
                    onSubmit={guess}
                    solved={round.songSolved}
                    solvedLabel={t("round.songSolved")}
                    solvedValue={solo.song}
                    inputRef={songRef}
                  />
                )}
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
                {left} left
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
                <Board
                  attempts={round.attempts}
                  total={config.ladderMs.length}
                  guessSong={config.guessSong}
                />
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
          ladderLength={config.ladderMs.length}
          onReset={resetStats}
          onClose={() => setPanel(null)}
        />
      )}
    </div>
  );
}

function Header({
  mode, catalog, onOpen,
}: {
  mode: Mode;
  catalog: string;
  onOpen: (panel: "settings" | "stats") => void;
}) {
  return (
    <header className="flex flex-wrap items-center gap-x-8 gap-y-3 border-b border-ink-edge px-6 py-4 sm:px-10 lg:px-14">
      <Link href="/" className="flex items-center gap-3">
        <span className="block h-4 w-4 bg-flame" aria-hidden="true" />
        <span className="type-display text-xl text-paper">{t("brand")}</span>
      </Link>

      <nav className="flex gap-6">
        <NavLink href="/" active={mode === "daily"}>{t("nav.daily")}</NavLink>
        <NavLink href="/practice" active={mode === "practice"}>{t("nav.practice")}</NavLink>
        <NavLink href="/admin" active={false}>{t("nav.admin")}</NavLink>
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
          href="/admin"
          className="type-eyebrow mt-8 inline-block bg-flame px-5 py-3 text-ink transition-colors hover:bg-paper"
        >
          {t("nav.admin")}
        </Link>
      </div>
    </div>
  );
}
