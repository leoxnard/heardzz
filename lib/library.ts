import { readFile } from "node:fs/promises";
import { LIBRARY_PATH } from "./paths";
import { tuneKey } from "./slug";
import type { Solo, SoloLibrary } from "./types";

/**
 * Read from disk on every request rather than importing the JSON, so a clip
 * added through the admin screen or the CLI shows up without a restart.
 */
export async function loadLibrary(): Promise<SoloLibrary> {
  try {
    const raw = await readFile(LIBRARY_PATH, "utf8");
    const parsed = JSON.parse(raw) as SoloLibrary;
    return {
      version: parsed.version ?? 1,
      /*
       * A record written before soloists existed has none. The leader is the
       * soloist far more often than not, so defaulting to the artist keeps
       * every level playable on an old library rather than asking a question
       * with no answer behind it.
       */
      solos: Array.isArray(parsed.solos)
        ? parsed.solos.map((solo) => ({ ...solo, soloist: solo.soloist || solo.artist }))
        : [],
    };
  } catch {
    return { version: 1, solos: [] };
  }
}

export async function loadSolos(): Promise<Solo[]> {
  const { solos } = await loadLibrary();
  return solos;
}

/**
 * Entries that are already this record.
 *
 * Two ways to be the same record and both of them count: the same upload, or
 * the same tune by the same artist off a different upload. A record with
 * three soloists returns three entries — that is one record, marked again,
 * not three duplicates.
 */
export function findDuplicates(
  solos: Solo[],
  record: { youtubeId?: string; artist?: string; song?: string },
): Solo[] {
  const tune = record.artist && record.song ? tuneKey(record.artist, record.song) : null;

  return solos.filter((solo) => {
    if (record.youtubeId && solo.youtubeId === record.youtubeId) return true;
    return tune !== null && tuneKey(solo.artist, solo.song) === tune;
  });
}
