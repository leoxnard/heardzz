/** Types for the separator, which stays plain ESM for the same reason the
 *  extraction pipeline does: the CLI runs it directly and the routes import
 *  the same code. */

import type { StemSet } from "@/lib/types";

export const MODEL: string;
export const STEM_HEADS: string[];
export const STEM_IDS: string[];

/** The separator head a soloist's instrument lands in. */
export function leadStemFor(role: string | undefined): string;

export function ensureSeparator(options?: {
  onProgress?: (step: string) => void;
}): Promise<string>;

export function separatorIsReady(): boolean;

export function judgeStem(args: {
  stemFile: string;
  mixFile: string;
  leadIn: number;
}): Promise<{
  usable: boolean;
  openLevel: number | null;
  relativeLevel: number | null;
  onsetPeak: number | null;
}>;

export function separateClip(args: {
  clipId: string;
  leadIn: number;
  role?: string;
  onProgress?: (step: string) => void;
}): Promise<StemSet>;

/** Every file `separateClip` may have written for a clip, as bare filenames. */
export function stemFilesFor(clipId: string): string[];
