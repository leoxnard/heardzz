/** Types for the extraction pipeline, which stays plain ESM so the CLI can
 *  run it directly with node and the admin routes can import the same code. */

export const PRE_ROLL: number;
export const POST_ROLL: number;
export const CLIP_LENGTH: number;
export const DATA_DIR: string;
export const AUDIO_DIR: string;
export const SOURCE_DIR: string;
export const SUGGESTIONS_PATH: string;
export const LIBRARY_PATH: string;

export function slugify(value: string): string;
export function parseTimecode(value: string | number | null | undefined): number;
export function formatTimecode(seconds: number): string;
export function checkTools(): Promise<void>;

export function resolveSource(target: string): Promise<{
  youtubeId: string;
  title: string;
  duration: number;
  uploader: string;
  /** Only present on YouTube Music and "Topic" uploads; "" otherwise. */
  artist: string;
  track: string;
  album: string;
  year: number;
}>;

export const SILENT_DBFS: number;

export function levelAtMarker(
  file: string,
  marker: number,
  seconds?: number,
): Promise<number | null>;

/** Seconds until the music starts, for sources that open with dead air. */
export function detectAudibleStart(file: string): Promise<number>;

/** Sound at this point, and markedly less just before it. */
export function looksLikeAnOnset(file: string, marker: number): Promise<boolean>;

export interface CutClip {
  audio: string;
  /** The start actually used, with "opening" resolved to seconds. */
  soloStart: number;
  leadIn: number;
  clipDuration: number;
  /** Length of the whole recording, not just the cut window. */
  sourceDuration: number;
  /** Mean dBFS of the first two seconds the game would play, or null. */
  markerLevel: number | null;
}

export function extractClip(options: {
  youtubeId: string;
  /** Seconds into the source, or "opening" to cut from the first audible moment. */
  soloStart: number | "opening";
  outputId: string;
  onProgress?: (message: string) => void;
  /** Keep the downloaded recording on disk instead of dropping it. */
  keepSource?: boolean;
}): Promise<CutClip>;

/** The URL the browser uses for a held recording. */
export function sourcePreviewUrl(youtubeId: string): string;

export function sourceIsReady(youtubeId: string): boolean;

/** Put a whole recording on disk, ready to be marked up. Idempotent. */
export function fetchSource(options: {
  youtubeId: string;
  onProgress?: (message: string) => void;
}): Promise<{
  youtubeId: string;
  previewUrl: string;
  duration: number;
  /** Where the music starts, so the opening marker is placed for you. */
  audibleStart: number;
}>;

/** Cut one clip out of a recording already on disk. No network. */
export function cutFromSource(options: {
  youtubeId: string;
  start: number | "opening";
  outputId: string;
  onProgress?: (message: string) => void;
}): Promise<CutClip>;

export function dropSource(youtubeId: string): Promise<void>;

export function listSources(): Promise<
  { youtubeId: string; bytes: number; fetchedAt: number }[]
>;

export function readLibrary(): Promise<{ version: number; solos: unknown[] }>;
export function writeLibrary(library: { version: number; solos: unknown[] }): Promise<void>;
export function nextCatalog(library: { solos: unknown[] }): string;
export function upsertSolo<T>(solo: T): Promise<T>;

export interface AudioTarget {
  /** Filename stem — the clip lives at `${outputId}.mp3` in AUDIO_DIR. */
  outputId: string;
  youtubeId: string;
  /** Where to cut from, in seconds, or "opening" for the head clip's fallback. */
  start: number | "opening";
}

/** Every clip file the library names, one entry per distinct file. */
export function audioTargets(solos: { audio?: string; soloClip?: { audio: string; start: number }; youtubeId: string; soloStart: number }[]): AudioTarget[];

/** Audio targets whose file is not actually on disk. */
export function missingAudioTargets(solos: Parameters<typeof audioTargets>[0]): AudioTarget[];

/** Write a freshly cut clip's numbers onto every solo entry that names it. Returns how many were touched. */
export function applyClipToLibrary(outputId: string, clip: CutClip): Promise<number>;

/** One flat pass over a playlist index; carries no artist/track tags. */
export interface PlaylistEntry {
  youtubeId: string;
  title: string;
  duration: number;
  uploader: string;
}

export function resolvePlaylist(target: string, limit?: number): Promise<PlaylistEntry[]>;
