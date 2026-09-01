/* ------------------------------------------------------------------
   Every tunable in the game lives here.

   These are the defaults. The settings panel writes overrides into
   localStorage; "Reset to defaults" throws those away and comes back to
   exactly this file. Edit it and hot reload picks it up immediately.
   ------------------------------------------------------------------ */

export interface GameConfig {
  /**
   * How much audio each attempt unlocks, in milliseconds, measured from the
   * point the round starts. One entry per attempt — adding a number gives the player
   * another guess. Order is not enforced, so a deliberately cruel ladder
   * that goes backwards is allowed, and nothing stops a rung below the
   * half-second the game now opens on.
   */
  ladderMs: number[];

  /** Ask for the song title as well as the soloist. */
  guessSong: boolean;

  /** A skip burns an attempt and unlocks the next rung. Off: skips are free. */
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
  ladderMs: [500, 2000, 5000, 10000, 20000],
  guessSong: true,
  skipCostsAttempt: true,
  volume: 0.85,
  leadInMs: 0,
  verifiedOnly: false,
};

/** Offered in the settings panel as one-click ladders. */
export const LADDER_PRESETS: { id: string; label: string; ladderMs: number[] }[] = [
  { id: "connoisseur", label: "Connoisseur", ladderMs: [500, 2000, 5000, 10000, 20000] },
  { id: "standard", label: "Standard", ladderMs: [1000, 2000, 4000, 7000, 11000, 16000] },
  { id: "easy", label: "Open ear", ladderMs: [3000, 6000, 10000, 15000, 22000, 30000] },
];

export const CONFIG_STORAGE_KEY = "heardzz:config:v1";
export const STATS_STORAGE_KEY = "heardzz:stats:v1";
export const DAILY_STORAGE_KEY = "heardzz:daily:v1";

/** Clip length the extractor cuts. Bounds the largest usable ladder rung. */
export const CLIP_SECONDS = 32;

export function clampConfig(input: Partial<GameConfig>): GameConfig {
  const merged = { ...DEFAULT_CONFIG, ...input };
  const ladder = (Array.isArray(merged.ladderMs) ? merged.ladderMs : DEFAULT_CONFIG.ladderMs)
    .map((ms) => Math.round(Number(ms)))
    .filter((ms) => Number.isFinite(ms) && ms >= 10 && ms <= CLIP_SECONDS * 1000)
    .slice(0, 12);

  return {
    ...merged,
    ladderMs: ladder.length > 0 ? ladder : DEFAULT_CONFIG.ladderMs,
    volume: Math.min(1, Math.max(0, Number(merged.volume) || 0)),
    leadInMs: Math.min(5000, Math.max(0, Math.round(Number(merged.leadInMs) || 0))),
  };
}
