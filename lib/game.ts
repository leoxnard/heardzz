import type { Attempt, Field, RoundState, Solo, Stats } from "./types";
import { activeFields, type GameConfig } from "./config";
import { artistMatches, songMatches } from "./lexicon";
import { sameArtist } from "./duplicates";
import { formatSnippet } from "./audio";

export function createRound(soloId: string): RoundState {
  return {
    soloId,
    attempts: [],
    rung: 0,
    solved: [],
    status: "playing",
  };
}

/** Which rung the player is on. Stays on the last rung once the budget runs out. */
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

/**
 * The ladder is a budget of wrong answers, not of guesses.
 *
 * A correct answer costs nothing — it leaves the rung where it is and lets
 * the player carry on at the same length of audio. So the round can only be
 * lost by missing, and a run of right answers can never run it out.
 */
function misses(state: RoundState): number {
  return state.attempts.filter((attempt) => !attempt.correct).length;
}

export function missesLeft(state: RoundState, config: GameConfig): number {
  return Math.max(0, config.ladderMs.length - misses(state));
}

/**
 * The attempts, split into turns.
 *
 * A turn is everything answered on one rung: right answers cost nothing and
 * leave the ladder where it is, so naming the artist and then the tune off
 * the same half-second happened at one length of audio and is one turn. Only
 * a wrong answer or a pass closes one, because only those move the ladder.
 *
 * Both the board and the shared grid read this, and they must agree — a grid
 * with more rows in it than the board had is a different round.
 */
export function turnsOf(attempts: Attempt[]): Attempt[][] {
  const turns: Attempt[][] = [];
  let current: Attempt[] = [];

  for (const attempt of attempts) {
    current.push(attempt);
    if (!attempt.correct) {
      turns.push(current);
      current = [];
    }
  }
  if (current.length > 0) turns.push(current);

  return turns;
}

/** Categories still open, in the order they are asked. */
export function openFields(state: RoundState, config: GameConfig): Field[] {
  return activeFields(config).filter((field) => !state.solved.includes(field));
}

function matches(field: Field, guess: string, solo: Solo): boolean {
  switch (field) {
    case "artist":
      /*
       * Two questions, because one of them was letting real answers
       * through and the other was not. `artistMatches` compares the names
       * as written, with a typo budget and the nickname table — right for
       * "Trane", and no help at all when the record is billed to an
       * ensemble. `sameArtist` folds both sides the way the library folds
       * them when deciding two records are the same, which is exactly the
       * question being asked: is this the same act?
       */
      return artistMatches(guess, solo.artist) || sameArtist(guess, solo.artist);
    case "song":
      return songMatches(guess, solo.song);
    case "soloist":
      // Same nickname table and typo budget as the artist: a soloist is a
      // person's name too, and Trane is Trane in either box.
      return (
        artistMatches(guess, solo.soloist || solo.artist) ||
        sameArtist(guess, solo.soloist || solo.artist)
      );
  }
}

function settle(state: RoundState, config: GameConfig): RoundState {
  if (openFields(state, config).length === 0) {
    return { ...state, status: "won" };
  }
  if (misses(state) >= config.ladderMs.length) {
    return { ...state, status: "lost" };
  }
  return { ...state, status: "playing" };
}

/**
 * Answer one category.
 *
 * Right: the field locks and the ladder stays put, so the rest of the record
 * is still being guessed on the same half-second. Wrong: the ladder moves and
 * the next category is up. Getting everything first time means hearing
 * nothing more than the opening rung.
 */
export function submitGuess(
  state: RoundState,
  solo: Solo,
  field: Field,
  value: string,
  config: GameConfig,
): RoundState {
  if (state.status !== "playing") return state;
  if (state.solved.includes(field)) return state;
  if (!activeFields(config).includes(field)) return state;

  const guess = value.trim();
  if (!guess) return state;

  const hit = matches(field, guess, solo);
  const attempt: Attempt = { field, value: guess, correct: hit, skipped: false };

  const settled = settle(
    {
      ...state,
      attempts: [...state.attempts, attempt],
      solved: hit ? [...state.solved, field] : state.solved,
    },
    config,
  );

  // Only a miss that leaves the round open buys more audio.
  return settled.status === "playing" && !hit
    ? { ...settled, rung: advance(state, config) }
    : settled;
}

/** Pass on a category without answering it. Costs the same as being wrong. */
export function skipAttempt(state: RoundState, field: Field, config: GameConfig): RoundState {
  if (state.status !== "playing") return state;
  if (state.solved.includes(field)) return state;

  // A free skip still has to move the ladder, or the button does nothing at all.
  if (!config.skipCostsAttempt) {
    return { ...state, rung: advance(state, config) };
  }

  const attempt: Attempt = { field, value: null, correct: false, skipped: true };

  return settle(
    { ...state, attempts: [...state.attempts, attempt], rung: advance(state, config) },
    config,
  );
}

export function giveUp(state: RoundState, config: GameConfig): RoundState {
  if (state.status !== "playing") return state;

  // Spend the rest of the budget, so the board and the shared grid read as a
  // finished round rather than a walk-out. Every filler is a pass on the same
  // question: spreading them over the open fields would draw a zigzag in the
  // grid, which looks like someone answering rather than someone stopping.
  const attempts = [...state.attempts];
  const [first] = openFields(state, config);
  while (attempts.filter((attempt) => !attempt.correct).length < config.ladderMs.length) {
    attempts.push({ field: first ?? "artist", value: null, correct: false, skipped: true });
  }

  return {
    ...state,
    attempts,
    rung: config.ladderMs.length - 1,
    status: "lost",
  };
}

/* ------------------------------------------------------------------
   Stats
   ------------------------------------------------------------------ */

export const STATS_VERSION = 2;

export const EMPTY_STATS: Stats = {
  version: STATS_VERSION,
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
  config: GameConfig,
  dateKey: string | null,
): Stats {
  const won = state.status === "won";
  const distribution = [...stats.distribution];

  // Bucketed by how little audio it took, because that is now the score.
  // How many guesses it took is no longer interesting: right answers are free.
  if (won) {
    const slot = rungIndex(state, config);
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
    version: STATS_VERSION,
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
 * One column per question — artist, then title, then who is playing.
 * A row is one guess, and it shows the state of every answer after it, so
 * reading a friend's grid tells you which half they got and when.
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

  const fields = activeFields(config);
  const done = new Set<Field>();

  // One row per turn, exactly as the board draws it.
  const rows = turnsOf(state.attempts).map((turn) => {
    for (const attempt of turn) {
      if (attempt.correct) done.add(attempt.field);
    }
    // A pass answers nothing, so it shows as a pass in every column still
    // open — marking only the field it was aimed at would read as a wrong
    // answer everywhere else. The last attempt is the one that closed the
    // turn, so it is the one that decides how the open columns read.
    const closed = turn[turn.length - 1];
    return fields
      .map((field) => (done.has(field) ? CORRECT : closed.skipped ? SKIPPED : WRONG))
      .join("");
  });

  const heard = formatSnippet(unlockedMs(state, config));
  const score = state.status === "won" ? `heard ${heard}` : `X · heard ${heard}`;

  return [heading, ...rows, score].join("\n");
}
