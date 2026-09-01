import { readFile } from "node:fs/promises";
import { LIBRARY_PATH } from "./paths";
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
      solos: Array.isArray(parsed.solos) ? parsed.solos : [],
    };
  } catch {
    return { version: 1, solos: [] };
  }
}

export async function loadSolos(): Promise<Solo[]> {
  const { solos } = await loadLibrary();
  return solos;
}
