/* ------------------------------------------------------------------
   Every tunable in the game lives here.

   These are the defaults. The settings panel writes overrides into
   localStorage; "Reset to defaults" throws those away and comes back to
   exactly this file. Edit it and hot reload picks it up immediately.
   ------------------------------------------------------------------ */

import type { Field, Solo, SoloClip, StemChoice, StemId, StemSet } from "./types";

/* ------------------------------------------------------------------
   Levels.

   Difficulty is not a matter of time — the ladder is the same whichever
   level you play. What changes is where the clip starts and how many
   questions the record has to answer.
   ------------------------------------------------------------------ */

export type LevelId = "ear" | "standard" | "blindfold";

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
  /*
   * Named after the Blindfold Test — Leonard Feather's column in DownBeat,
   * running since 1946, where a musician is played a record cold, told
   * nothing about it, and asked who that is. Which is this level exactly.
   *
   * It does not ask for the artist. On most of these records the soloist is
   * the artist, so asking for both was asking the same question twice, in
   * two boxes, one of which was already filled in. What is left is the two
   * things a blindfold test actually asks: who is that, and what are they
   * playing.
   */
  {
    id: "blindfold",
    label: "Blindfold",
    blurb: "From the solo entry · who is playing, and the tune",
    start: "solo",
    fields: ["soloist", "song"],
    choice: [],
  },
];

export function levelOf(config: GameConfig): Level {
  return LEVELS.find((level) => level.id === config.level) ?? LEVELS[1];
}

/**
 * The head level a solo level stands down to.
 *
 * Blindfold asks who is playing, which is a question about a marked solo —
 * a screen with no marked solos on it cannot ask it at all. So it stands
 * down to standard, which asks the nearest thing it can: the name on the
 * sleeve, and the tune.
 */
const STANDS_DOWN_TO: Record<LevelId, LevelId> = {
  ear: "ear",
  standard: "standard",
  blindfold: "standard",
};

/** The levels a screen can offer. */
export function levelsFor(soloLevels: boolean): Level[] {
  return soloLevels ? LEVELS : LEVELS.filter((level) => level.start === "head");
}

/**
 * The config a screen actually plays.
 *
 * The solo levels open at the solo entry, and only a record somebody has
 * marked up has one. A for-you sitting is records fetched minutes ago that
 * nobody has been near, so on that screen those levels have nothing to open.
 * The stored setting is left alone — it belongs to the player, not to the
 * screen they happen to be on — and the screen plays the nearest level it
 * can honour instead.
 */
export function playedConfig(config: GameConfig, soloLevels: boolean): GameConfig {
  if (soloLevels) return config;
  const level = STANDS_DOWN_TO[config.level] ?? DEFAULT_CONFIG.level;
  return level === config.level ? config : { ...config, level };
}

/* ------------------------------------------------------------------
   Stems.

   A third axis, and deliberately orthogonal to the other two: a level says
   where the clip opens and what it asks, and this says which layer of the
   recording is heard. Every combination is meant to be legal — the blindfold
   test with only the horn is a different question from the blindfold test
   with only the rhythm section, and both are worth asking.
   ------------------------------------------------------------------ */

export interface Stem {
  id: StemChoice;
  label: string;
  blurb: string;
}

export const STEMS: Stem[] = [
  { id: "full", label: "The record", blurb: "As it was pressed" },
  { id: "lead", label: "Only the soloist", blurb: "Whoever is out front, lifted out of the band" },
  { id: "rhythm", label: "Only the rhythm section", blurb: "The band, with the lead voice gone" },
  { id: "bass", label: "Only the bass", blurb: "The walk, on its own" },
];

/** The stems belonging to whichever cut a level opens on. */
export function stemsOf(solo: Solo, level: Level): StemSet | undefined {
  return level.start === "solo" && solo.soloClip ? solo.soloClip.stems : solo.stems;
}

/**
 * Can this record be dealt at this stem, on this level?
 *
 * Two things have to be true and they fail for different reasons. The files
 * may not exist yet, because splitting a record is a separate pass over the
 * library and a record added this morning has not had it. And the variant may
 * exist and be empty: a piano trio has no horn to lift out, and a tune that
 * opens on an unaccompanied pickup has no rhythm section in its first half
 * second. Both end the same way — the record is not dealt — but only the
 * second one is a judgement about the music.
 */
export function hasStem(solo: Solo, level: Level, stem: StemChoice): boolean {
  if (stem === "full") return true;
  return stemsOf(solo, level)?.[stem]?.usable === true;
}

/**
 * The stem a screen actually plays.
 *
 * Mirrors what `playedConfig` does for levels, and for the same reason: the
 * stored setting belongs to the player, not to the pool they happen to be
 * looking at. If nothing in the pool can be played at the chosen stem, the
 * screen falls back to the full mix rather than showing an empty board, and
 * the setting is left where it was.
 */
export function playedStem(config: GameConfig, pool: Solo[], level: Level): StemChoice {
  if (config.stem === "full") return "full";
  return pool.some((solo) => hasStem(solo, level, config.stem)) ? config.stem : "full";
}

/**
 * The file a round plays: the cut the level asks for, at the stem chosen.
 *
 * Falls back to the full mix whenever the variant is missing or empty, so a
 * caller never has to check first. A stem shares its parent cut's geometry
 * exactly, which is why only `audio` is replaced.
 */
export function playedClip(
  solo: Solo,
  level: Level,
  stem: StemChoice,
): Pick<SoloClip, "audio" | "leadIn" | "clipDuration"> {
  const base =
    level.start === "solo" && solo.soloClip
      ? solo.soloClip
      : { audio: solo.audio, leadIn: solo.leadIn, clipDuration: solo.clipDuration };

  if (stem === "full") return base;
  const variant = stemsOf(solo, level)?.[stem as StemId];
  return variant?.usable ? { ...base, audio: variant.audio } : base;
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


  /** Keep unconfirmed start points out of play. */
  verifiedOnly: boolean;

  /**
   * Which layer of the recording is heard. Independent of the level: the
   * level picks the cut, this picks what is playing inside it.
   */
  stem: StemChoice;
}

export const DEFAULT_CONFIG: GameConfig = {
  level: "standard",
  ladderMs: [500, 2000, 5000, 10000, 20000],
  guessSong: true,
  skipCostsAttempt: true,
  volume: 0.85,
  verifiedOnly: false,
  stem: "full",
};

/*
 * One-click ladders, independent of level. Named after where they open
 * rather than after a kind of listener — what separates them is the first
 * rung, and a name like "connoisseur" says nothing about that.
 */
export const LADDER_PRESETS: { id: string; label: string; ladderMs: number[] }[] = [
  /*
   * For a round of records you already know.
   *
   * The easiest for-you door plays tunes the listener's own history says
   * they have played, often hundreds of times, and against those the
   * ordinary ladder hands over the answer before it has finished asking —
   * twenty seconds of a record you know is not a question. This one tops
   * out where that one opens, which turns the round from "have you heard
   * this" into "how fast".
   *
   * A preset rather than something that mode switches to by itself: which
   * ladder suits a sitting is the listener's call, and a game that quietly
   * rewrites the settings is a game you cannot trust the settings of.
   */
  { id: "reflex", label: "Opens at 0.25s", ladderMs: [250, 500, 1000, 2000, 5000] },
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
    stem: STEMS.some((stem) => stem.id === merged.stem) ? merged.stem : DEFAULT_CONFIG.stem,
  };
}
