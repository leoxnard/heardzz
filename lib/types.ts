/* ------------------------------------------------------------------
   Domain model.

   One Solo is one puzzle. A recording with three soloists becomes three
   Solo entries sharing a youtubeId and differing in soloStart — which is
   how "So What" holds Miles, Coltrane and Cannonball without any special
   casing anywhere downstream.
   ------------------------------------------------------------------ */

export interface Credit {
  name: string;
  /** Instruments, comma separated. Empty when the credit names no role. */
  role: string;
}

export interface Solo {
  /** Stable slug, also the audio filename stem. */
  id: string;
  /** Sleeve catalogue number. Structural, not decorative: it is the sort key. */
  catalog: string;

  /** Answer one: the name the recording was released under. */
  artist: string;
  /** Answer two. */
  song: string;

  album: string;
  year: number;

  /**
   * Everyone playing on the date, from Discogs. Shown when the round closes,
   * never before — half the pleasure of a jazz record is finding out who was
   * in the room.
   */
  personnel: Credit[];

  /** The Discogs release the credits came from, so they can be re-checked. */
  discogsReleaseId?: number;

  /** Source. Retained so a clip can always be recut from scratch. */
  youtubeId: string;
  /** Where the round starts in the source video, in seconds. */
  soloStart: number;

  /**
   * Where the solo enters in the source, kept even when the round starts
   * somewhere else. Rounds currently open at the top of the tune; this is
   * what a later switch back to solos would cut from.
   */
  soloAt?: number;

  /** Served from /public. */
  audio: string;
  /** Seconds of the clip file that sit before the solo entry. */
  leadIn: number;
  /** Length of the clip file in seconds. */
  clipDuration: number;

  /**
   * Length of the whole recording. The clip is a window onto it, and this is
   * what lets the library screen move that window somewhere else.
   */
  sourceDuration?: number;

  /**
   * False until a human has confirmed soloStart against the waveform.
   * The admin screen sorts on this, and the game can be told to skip them.
   */
  verified: boolean;

  /** One line of context, shown only after the round closes. */
  note?: string;
}

export interface SoloLibrary {
  version: number;
  solos: Solo[];
}

/* ------------------------------------------------------------------
   Play state
   ------------------------------------------------------------------ */

export type Field = "artist" | "song";

export interface Attempt {
  /** What was typed, verbatim, so the board can show it back. */
  artist: string | null;
  song: string | null;
  artistCorrect: boolean;
  songCorrect: boolean;
  skipped: boolean;
}

export type RoundStatus = "playing" | "won" | "lost";

export interface RoundState {
  soloId: string;
  attempts: Attempt[];
  /**
   * Highest ladder rung unlocked. Tracked separately from attempts.length
   * because a free skip advances the audio without spending a guess.
   */
  rung: number;
  /** Locks once guessed correctly; the field stops accepting input. */
  artistSolved: boolean;
  songSolved: boolean;
  status: RoundStatus;
}

export interface DailyRecord {
  /** YYYY-MM-DD in the player's own timezone. */
  date: string;
  /** The whole round, so reopening the tab restores the board rather than the result alone. */
  state: RoundState;
}

export interface Stats {
  played: number;
  won: number;
  currentStreak: number
  maxStreak: number;
  /** Index = attempt number the round was won on. */
  distribution: number[];
  lastPlayedDate: string | null;
}
