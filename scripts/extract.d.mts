/** Types for the extraction pipeline, which stays plain ESM so the CLI can
 *  run it directly with node and the admin routes can import the same code. */

export const PRE_ROLL: number;
export const POST_ROLL: number;
export const CLIP_LENGTH: number;
export const AUDIO_DIR: string;
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
}>;

export const SILENT_DBFS: number;

export function levelAtMarker(file: string, marker: number): Promise<number | null>;

/** Seconds until the music starts, for sources that open with dead air. */
export function detectAudibleStart(file: string): Promise<number>;

export function extractClip(options: {
  youtubeId: string;
  /** Seconds into the source, or "opening" to cut from the first audible moment. */
  soloStart: number | "opening";
  outputId: string;
  onProgress?: (message: string) => void;
}): Promise<{
  audio: string;
  /** The start actually used, with "opening" resolved to seconds. */
  soloStart: number;
  leadIn: number;
  clipDuration: number;
  /** Mean dBFS of the first two seconds the game would play, or null. */
  markerLevel: number | null;
}>;

export function readLibrary(): Promise<{ version: number; solos: unknown[] }>;
export function writeLibrary(library: { version: number; solos: unknown[] }): Promise<void>;
export function nextCatalog(library: { solos: unknown[] }): string;
export function upsertSolo<T>(solo: T): Promise<T>;
