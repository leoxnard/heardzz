/* ------------------------------------------------------------------
   Every tunable in the game lives here.

   These are the defaults. The settings panel writes overrides into
   localStorage; "Reset to defaults" throws those away and comes back to
   exactly this file. Edit it and hot reload picks it up immediately.
   ------------------------------------------------------------------ */

import type { Field } from "./types";

/* ------------------------------------------------------------------
   Levels.

   Difficulty is not a matter of time — the ladder is the same whichever
   level you play. What changes is where the clip starts and how many
   questions the record has to answer.
   ------------------------------------------------------------------ */

export type LevelId = "ear" | "standard" | "connoisseur" | "blindfold";

export interface Level {
  id: LevelId;
  label: string;
  /** One line under the picker, so the jump between levels is legible. */
  blurb: string;
  /** "head" opens at the top of the tune, "solo" at the solo entry. */
  start: "head" | "solo";
  fields: Field[];
  /** Fields answered by picking from a list rather than typing. */
  choice: Field[];
}

export const LEVELS: Level[] = [
  {
    id: "ear",
    label: "Open ear",
    blurb: "From the top · artist, from five names",
    start: "head",
    fields: ["artist"],
    choice: ["artist"],
  },
  {
    id: "standard",
    label: "Standard",
    blurb: "From the top · artist and title",
    start: "head",
    fields: ["artist", "song"],
    choice: [],
  },
  {
    id: "connoisseur",
    label: "Connoisseur",
    blurb: "From the solo entry · artist and title",
    start: "solo",
    fields: ["artist", "song"],
    choice: [],
  },
  {
    id: "blindfold",
    label: "Blindfold",
    blurb: "From the solo entry · artist, title and who is playing",
    start: "solo",
    fields: ["artist", "song", "soloist"],
    choice: [],
  },
];

export function levelOf(config: GameConfig): Level {
  return LEVELS.find((level) => level.id === config.level) ?? LEVELS[1];
}

/**
 * The categories this round actually asks for.
 *
 * The level decides, except that turning the title off in settings still
 * wins — it predates levels and people have it set.
 */
export function activeFields(config: GameConfig): Field[] {
  const fields = levelOf(config).fields;
  return config.guessSong ? fields : fields.filter((field) => field !== "song");
}

export interface GameConfig {
  /** Which level is being played. Decides the start point and the questions. */
  level: LevelId;

  /**
   * How much audio a miss unlocks, in milliseconds, measured from the point
   * the round starts. One entry per miss — adding a number buys another
   * wrong answer. Deliberately the same at every level: what a level changes
   * is the questions, not the clock. Order is not enforced, so a cruel
   * ladder that goes backwards is allowed.
   */
  ladderMs: number[];

  /** Ask for the song title as well as the soloist. */
  guessSong: boolean;

  /** A skip counts as a miss and unlocks the next rung. Off: skips are free. */
  skipCostsAttempt: boolean;

  /** 0–1. */
  volume: number;

  /**
   * Play a short lead-in ahead of the start point so the ear has somewhere
   * to land. Zero is the honest setting and the default.
   */
  leadInMs: number;

  /** Keep unconfirmed start points out of play. */
  verifiedOnly: boolean;
}

export const DEFAULT_CONFIG: GameConfig = {
  level: "standard",
  ladderMs: [500, 2000, 5000, 10000, 20000],
  guessSong: true,
  skipCostsAttempt: true,
  volume: 0.85,
  leadInMs: 0,
  verifiedOnly: false,
};

/*
 * One-click ladders, independent of level. Named after where they open
 * rather than after a kind of listener: the levels own those names now, and
 * two "Connoisseur" buttons in one panel is one too many. What separates
 * these three is the first rung anyway.
 */
export const LADDER_PRESETS: { id: string; label: string; ladderMs: number[] }[] = [
  { id: "connoisseur", label: "Opens at 0.5s", ladderMs: [500, 2000, 5000, 10000, 20000] },
  { id: "standard", label: "Opens at 1s", ladderMs: [1000, 2000, 4000, 7000, 11000, 16000] },
  { id: "easy", label: "Opens at 3s", ladderMs: [3000, 6000, 9000, 13000, 16000, 20000] },
];

export const CONFIG_STORAGE_KEY = "heardzz:config:v1";
export const STATS_STORAGE_KEY = "heardzz:stats:v1";
/*
 * v2: a stored round used to carry artistSolved/songSolved and a slot per
 * category on every attempt. Bumping the key throws a v1 record away rather
 * than reading it as something it is not.
 */
export const DAILY_STORAGE_KEY = "heardzz:daily:v2";

/**
 * How much of a clip a round can play, in seconds. Bounds the largest usable
 * ladder rung, and has to stay in step with POST_ROLL in scripts/extract.mjs
 * — the file also carries a couple of seconds ahead of the marker, which is
 * headroom for moving the entry point rather than anything the game plays.
 */
export const CLIP_SECONDS = 20;

export function clampConfig(input: Partial<GameConfig>): GameConfig {
  const merged = { ...DEFAULT_CONFIG, ...input };
  const ladder = (Array.isArray(merged.ladderMs) ? merged.ladderMs : DEFAULT_CONFIG.ladderMs)
    .map((ms) => Math.round(Number(ms)))
    .filter((ms) => Number.isFinite(ms) && ms >= 10 && ms <= CLIP_SECONDS * 1000)
    .slice(0, 12);

  return {
    ...merged,
    level: LEVELS.some((level) => level.id === merged.level) ? merged.level : DEFAULT_CONFIG.level,
    ladderMs: ladder.length > 0 ? ladder : DEFAULT_CONFIG.ladderMs,
    volume: Math.min(1, Math.max(0, Number(merged.volume) || 0)),
    leadInMs: Math.min(5000, Math.max(0, Math.round(Number(merged.leadInMs) || 0))),
  };
}
