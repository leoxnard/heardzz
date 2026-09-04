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

/** One cut of a recording: a file, and where in the source it came from. */
export interface SoloClip {
  audio: string;
  /** Where this clip starts in the source, in seconds. */
  start: number;
  /** Seconds of the file that sit before that start point. */
  leadIn: number;
  /** Length of the file in seconds. */
  clipDuration: number;
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

  /**
   * Whoever is actually playing the solo. Not the same thing as `artist`:
   * the name a record is released under is often the leader's, and the
   * horn you are listening to belongs to somebody else — "Moanin'" is an
   * Art Blakey record and a Lee Morgan solo. Always one of the names in
   * `personnel`.
   */
  soloist: string;
  /** The soloist's instrument, copied from their credit. */
  soloistRole?: string;

  /** The Discogs release the credits came from, so they can be re-checked. */
  discogsReleaseId?: number;

  /** Source. Retained so a clip can always be recut from scratch. */
  youtubeId: string;
  /** Where the round starts in the source video, in seconds. */
  soloStart: number;

  /**
   * Where the solo enters in the source. The head clip starts at the top of
   * the tune; this is what `soloClip` is cut from, and the harder levels
   * play that instead.
   */
  soloAt?: number;

  /** Served from /public. */
  audio: string;
  /** Seconds of the clip file that sit before the solo entry. */
  leadIn: number;
  /** Length of the clip file in seconds. */
  clipDuration: number;

  /**
   * A second cut of the same recording, starting at `soloAt` instead of the
   * top of the tune. Optional, and what it decides is whether the record can
   * be dealt at all at a level that opens at the solo entry: those levels
   * play only records that have one. Falling back to the head clip is what
   * this used to do, and it meant a hard level quietly handing out an easy
   * round.
   */
  soloClip?: SoloClip;

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

  /**
   * The recording's ISRC, when it arrived by way of TIDAL.
   *
   * The library has never had an identifier that means anything outside it —
   * a Discogs release is a pressing and a YouTube id is an upload, and both
   * can be several for one recording. An ISRC is the recording, so two
   * catalogues can agree about it without matching on spelling.
   */
  isrc?: string;
  /** The TIDAL artist this came from, so the same seed can be walked again. */
  tidalArtistId?: string;

  /**
   * Artists who sound like this one, for the multiple-choice levels.
   *
   * Only set on a for-you round. A library record does not need it: its
   * artist is in the lexicon, and `lib/lexicon/neighbours.ts` already holds
   * that answer. A for-you record can be anybody, so the neighbours are
   * fetched alongside the audio and travel with it — the alternative is a
   * lookup mid-round, and the game does not touch the network then.
   */
  nearArtists?: string[];
}

/**
 * One position on a recording, as it is marked up.
 *
 * The marking screen works in these: a place in the tune, whoever is playing
 * there, and anything worth saying about it. Cutting turns each one into a
 * Solo entry — the two are deliberately not the same shape, because a mark
 * exists before any clip does.
 */
export interface MarkedSolo {
  /** Set when the mark stands for an entry that already exists. */
  id?: string;
  /** Seconds into the recording. */
  at: number;
  soloist: string;
  note?: string;
}

export interface SoloLibrary {
  version: number;
  solos: Solo[];
}

/* ------------------------------------------------------------------
   Play state
   ------------------------------------------------------------------ */

export type Field = "artist" | "song" | "soloist";

/**
 * One guess at one category.
 *
 * A round asks several questions and each is answered on its own, so an
 * attempt names the field it was aimed at rather than carrying a slot per
 * category. `value` is what was typed, verbatim, so the board can show it back.
 */
export interface Attempt {
  field: Field;
  value: string | null;
  correct: boolean;
  skipped: boolean;
}

export type RoundStatus = "playing" | "won" | "lost";

export interface RoundState {
  soloId: string;
  attempts: Attempt[];
  /**
   * Highest ladder rung unlocked — and the score.
   *
   * Only a miss moves it. Tracked separately from attempts.length because a
   * correct answer buys no audio and a free skip buys audio without a guess.
   */
  rung: number;
  /** Categories already answered. A solved field stops accepting input. */
  solved: Field[];
  status: RoundStatus;
}

export interface DailyRecord {
  /** YYYY-MM-DD in the player's own timezone. */
  date: string;
  /** The whole round, so reopening the tab restores the board rather than the result alone. */
  state: RoundState;
}

export interface Stats {
  /**
   * Bumped when the shape of what is stored changes meaning rather than
   * structure. v2 moved the distribution from "attempts taken" to "rung
   * solved on"; the two are not comparable, so v1 histograms are dropped.
   */
  version?: number;
  played: number;
  won: number;
  currentStreak: number
  maxStreak: number;
  /** Index = ladder rung the round was won on, so it counts seconds heard. */
  distribution: number[];
  lastPlayedDate: string | null;
}

/* ------------------------------------------------------------------
   Suggestions

   Anyone can put a record forward; only the owner turns one into a clip.
   Nothing is downloaded until then, so a suggestion costs a few hundred
   bytes and no bandwidth.
   ------------------------------------------------------------------ */

export type SuggestionStatus = "pending" | "approved" | "rejected";

export interface Suggestion {
  id: string;
  youtubeId: string;
  /** The video's own title, kept so the reviewer can see what was meant. */
  sourceTitle: string;
  sourceDuration: number;

  artist: string;
  song: string;
  album: string;
  year: number;
  personnel: Credit[];
  /** Chosen at review time, out of the credits. Empty means the leader. */
  soloist?: string;
  discogsReleaseId?: number;
  note?: string;

  /** ISO timestamp. */
  submittedAt: string;
  status: SuggestionStatus;
  /** Filled in when a suggestion is turned down. */
  reason?: string;
}

export interface SuggestionStore {
  version: number;
  suggestions: Suggestion[];
}

/* ------------------------------------------------------------------
   Reports

   A player's only way to talk back: the clip does not play, or the sleeve
   says something that is not true. Both are worth knowing and neither is
   worth a support inbox, so it is one button and three choices.
   ------------------------------------------------------------------ */

export type ReportKind = "audio" | "info" | "other";
export type ReportStatus = "open" | "resolved";

export interface Report {
  id: string;
  soloId: string;
  /**
   * Copied from the solo at the moment of the report, so the admin list
   * reads on its own even if the entry is later edited or removed.
   */
  artist: string;
  song: string;
  catalog: string;
  kind: ReportKind;
  note?: string;
  /** How many times this exact problem, on this exact record, came in. */
  count: number;
  submittedAt: string;
  status: ReportStatus;
}

export interface ReportStore {
  version: number;
  reports: Report[];
}
