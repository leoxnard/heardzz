import path from "node:path";

/* ------------------------------------------------------------------
   Where the library lives.

   Everything the app writes at runtime — the library file, the pending
   suggestions, the clips themselves — sits under one directory that is
   deliberately outside the build. On a server that directory is a mounted
   volume, so approving a record survives the next deploy. Locally it is
   just ./data and nothing needs configuring.

   Clips used to live in public/. They cannot any more: a file written into
   public/ after the build is not part of the deployed image, and on a
   container it disappears with the container.
   ------------------------------------------------------------------ */

export const DATA_DIR = process.env.HEARDZZ_DATA_DIR
  ? path.resolve(process.env.HEARDZZ_DATA_DIR)
  : path.join(process.cwd(), "data");

export const AUDIO_DIR = path.join(DATA_DIR, "audio");
/** Whole recordings, held only while somebody is marking one up. */
export const SOURCE_DIR = path.join(DATA_DIR, "sources");
export const LIBRARY_PATH = path.join(DATA_DIR, "solos.json");
export const SUGGESTIONS_PATH = path.join(DATA_DIR, "suggestions.json");
export const REPORTS_PATH = path.join(DATA_DIR, "reports.json");
/** normalized artist name -> TIDAL id, built by crawling similar artists. */
export const TIDAL_ARTISTS_PATH = path.join(DATA_DIR, "tidal-artists.json");

/** Clip filenames are derived from slugs, so anything else is a probe. */
const SAFE_FILE = /^[a-z0-9][a-z0-9-]{0,120}\.mp3$/;

export function isSafeAudioName(name: string): boolean {
  return SAFE_FILE.test(name);
}

/** Held recordings are named by their YouTube id, which is not a slug. */
const SAFE_SOURCE = /^[A-Za-z0-9_-]{5,20}\.mp3$/;

export function isSafeSourceName(name: string): boolean {
  return SAFE_SOURCE.test(name);
}

/** The URL the browser uses for a clip. */
export function audioUrl(id: string): string {
  return `/api/audio/${id}.mp3`;
}
