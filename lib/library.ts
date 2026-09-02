import { readFile } from "node:fs/promises";
import { LIBRARY_PATH } from "./paths";
import type { Solo, SoloLibrary } from "./types";

/*
 * Duplicate matching moved to lib/duplicates.ts so the marking screen can run
 * it while you type — this file reaches for node:fs and cannot be imported
 * from a component. Re-exported because every caller already asks here.
 */
export { findDuplicates, recordKey } from "./duplicates";

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
