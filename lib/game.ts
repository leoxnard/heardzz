import type { Attempt, RoundState, Solo, Stats } from "./types";
import type { GameConfig } from "./config";
import { artistMatches, songMatches } from "./lexicon";
import { formatSnippet } from "./audio";

export function createRound(soloId: string): RoundState {
  return {
    soloId,
    attempts: [],
    rung: 0,
    artistSolved: false,
    songSolved: false,
    status: "playing",
  };
}

/** Which rung the player is on. Stays on the last rung once attempts run out. */
export function rungIndex(state: RoundState, config: GameConfig): number {
  return Math.min(state.rung, config.ladderMs.length - 1);
}

function advance(state: RoundState, config: GameConfig): number {
  return Math.min(state.rung + 1, config.ladderMs.length - 1);
}

/**
 * How much audio the player has actually been given. Deliberately not
 * raised to the top of the ladder when the round ends: the result card
 * reports this, and "solved on 0.5 seconds" is the whole boast.
 */
export function unlockedMs(state: RoundState, config: GameConfig): number {
  return config.ladderMs[rungIndex(state, config)];
}

export function attemptsLeft(state: RoundState, config: GameConfig): number {
  return Math.max(0, config.ladderMs.length - state.attempts.length);
}

function settle(state: RoundState, config: GameConfig): RoundState {
  const songDone = config.guessSong ? state.songSolved : true;

  if (state.artistSolved && songDone) {
    return { ...state, status: "won" };
  }
  if (state.attempts.length >= config.ladderMs.length) {
    return { ...state, status: "lost" };
  }
  return { ...state, status: "playing" };
}

export function submitGuess(
  state: RoundState,
  solo: Solo,
  guess: { artist: string; song: string },
  config: GameConfig,
): RoundState {
  if (state.status !== "playing") return state;

  const artistGuess = guess.artist.trim();
  const songGuess = guess.song.trim();
  if (!artistGuess && !songGuess) return state;

  const artistHit =
    state.artistSolved || (Boolean(artistGuess) && artistMatches(artistGuess, solo.artist));
  const songHit =
    state.songSolved ||
    (config.guessSong && Boolean(songGuess) && songMatches(songGuess, solo.song));

  const attempt: Attempt = {
    artist: artistGuess || null,
    song: songGuess || null,
    artistCorrect: !state.artistSolved && artistHit,
    songCorrect: !state.songSolved && songHit,
    skipped: false,
  };

  const settled = settle(
    {
      ...state,
      attempts: [...state.attempts, attempt],
      artistSolved: artistHit,
      songSolved: songHit,
    },
    config,
  );

  // Only a guess that leaves the round open buys more audio.
  return settled.status === "playing"
    ? { ...settled, rung: advance(state, config) }
    : settled;
}

export function skipAttempt(state: RoundState, config: GameConfig): RoundState {
  if (state.status !== "playing") return state;

  // A free skip still has to move the ladder, or the button does nothing at all.
  if (!config.skipCostsAttempt) {
    return { ...state, rung: advance(state, config) };
  }

  const attempt: Attempt = {
    artist: null,
    song: null,
    artistCorrect: false,
    songCorrect: false,
    skipped: true,
  };

  return settle(
    { ...state, attempts: [...state.attempts, attempt], rung: advance(state, config) },
    config,
  );
}

export function giveUp(state: RoundState, config: GameConfig): RoundState {
  if (state.status !== "playing") return state;
  const filler: Attempt = {
    artist: null, song: null,
    artistCorrect: false, songCorrect: false, skipped: true,
  };
  const padded = [...state.attempts];
  while (padded.length < config.ladderMs.length) padded.push(filler);
  return { ...state, attempts: padded, status: "lost" };
}

/* ------------------------------------------------------------------
   Stats
   ------------------------------------------------------------------ */

export const EMPTY_STATS: Stats = {
  played: 0,
  won: 0,
  currentStreak: 0,
  maxStreak: 0,
  distribution: [],
  lastPlayedDate: null,
};

export function recordResult(
  stats: Stats,
  state: RoundState,
  dateKey: string | null,
): Stats {
  const won = state.status === "won";
  const distribution = [...stats.distribution];

  if (won) {
    const slot = state.attempts.length - 1;
    while (distribution.length <= slot) distribution.push(0);
    distribution[slot] += 1;
  }

  // A streak only means something against the daily; practice rounds leave it alone.
  const continues = dateKey !== null && isConsecutive(stats.lastPlayedDate, dateKey);
  const currentStreak = dateKey === null
    ? stats.currentStreak
    : won
      ? (continues ? stats.currentStreak : 0) + 1
      : 0;

  return {
    played: stats.played + 1,
    won: stats.won + (won ? 1 : 0),
    currentStreak,
    maxStreak: Math.max(stats.maxStreak, currentStreak),
    distribution,
    lastPlayedDate: dateKey ?? stats.lastPlayedDate,
  };
}

function isConsecutive(previous: string | null, current: string): boolean {
  if (!previous) return false;
  const a = new Date(`${previous}T00:00:00`);
  const b = new Date(`${current}T00:00:00`);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000) === 1;
}

/* ------------------------------------------------------------------
   Share
   ------------------------------------------------------------------ */

const CORRECT = "🟧";
const WRONG = "⬛";
const SKIPPED = "⬜";

/**
 * Two columns because there are two answers: artist on the left, title on
 * the right. Reading a friend's grid tells you which half they got.
 */
export function buildShare(
  state: RoundState,
  solo: Solo,
  config: GameConfig,
  dateKey: string | null,
): string {
  const heading = dateKey
    ? `Heardzz ${solo.catalog} · ${dateKey}`
    : `Heardzz ${solo.catalog}`;

  const score = state.status === "won"
    ? `${state.attempts.length}/${config.ladderMs.length}`
    : `X/${config.ladderMs.length}`;

  let artistDone = false;
  let songDone = false;

  const rows = state.attempts.map((attempt) => {
    if (attempt.skipped) return `${SKIPPED}${config.guessSong ? SKIPPED : ""}`;
    artistDone = artistDone || attempt.artistCorrect;
    songDone = songDone || attempt.songCorrect;
    const left = artistDone ? CORRECT : WRONG;
    const right = songDone ? CORRECT : WRONG;
    return `${left}${config.guessSong ? right : ""}`;
  });

  const heard = formatSnippet(unlockedMs(state, config));

  return [`${heading} · ${score}`, ...rows, `heard ${heard}`].join("\n");
}
