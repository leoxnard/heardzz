/** Types for the separator, which stays plain ESM for the same reason the
 *  extraction pipeline does: the CLI runs it directly and the routes import
 *  the same code. */

import type { Credit, StemSet } from "@/lib/types";

export const MODEL: string;
export const STEM_HEADS: string[];
export const STEM_IDS: string[];
/** Piano, guitar, bass, drums — what a rhythm section is made of. */
export const RHYTHM_HEADS: string[];

/** Which cut of a recording is being split: its top, or its solo entry. */
export type Cut = "head" | "solo";

/** The separator head a soloist's instrument lands in. */
export function leadStemFor(role: string | undefined): string;

/** The head carrying the theme, for a cut where nobody is soloing yet. */
export function melodyStemFor(
  personnel: Credit[] | undefined,
  role: string | undefined,
  /** The name on the sleeve, used to find the leader among the credits. */
  artist?: string,
): string;

/** The head out front, which differs between the two cuts. */
/** What the split of a cut is decided from. */
export interface SplitShape {
  cut: Cut;
  role?: string;
  personnel?: Credit[];
  /** Names of whoever states the theme, for the head cut. */
  melody?: string[];
  artist?: string;
}

/** The heads out front. Several when the theme is stated in harmony. */
export function leadHeadsFor(args: SplitShape): string[];

/** The four rhythm instruments the band has, less whoever is out front. */
export function rhythmHeadsFor(args: SplitShape): string[];

export function melodyHeadsFor(args: {
  personnel?: Credit[];
  melody?: string[];
  role?: string;
  artist?: string;
}): string[];

/** The heads with an instrument behind them on this record. */
export function headsInCredits(personnel: Credit[] | undefined): Set<string>;

/** What a cut's split would come out as, as one comparable string. */
export function splitShapeFor(args: SplitShape): string;

export function ensureSeparator(options?: {
  onProgress?: (step: string) => void;
}): Promise<string>;

export function separatorIsReady(): boolean;

/** The opening half second, against the mix's own. */
export function judgeOnset(args: {
  playedFile: string;
  mixFile: string;
  leadIn: number;
}): Promise<{ onsetPeak: number | null; onsetRelative: number | null }>;

export function stemIsUsable(measured: {
  openLevel?: number | null;
  relativeLevel?: number | null;
  onsetPeak?: number | null;
  onsetRelative?: number | null;
}): boolean;

export function judgeStem(args: {
  /** The raw head, where the level is measured — before any gain. */
  stemFile: string;
  /** The encode a round plays, where the opening is measured. */
  playedFile?: string;
  mixFile: string;
  leadIn: number;
}): Promise<{
  usable: boolean;
  openLevel: number | null;
  relativeLevel: number | null;
  onsetPeak: number | null;
  onsetRelative: number | null;
}>;

export function separateClip(args: {
  clipId: string;
  leadIn: number;
  cut: Cut;
  role?: string;
  personnel?: Credit[];
  melody?: string[];
  artist?: string;
  /** The stems this cut already had, so an approval can survive a re-split. */
  previous?: StemSet;
  onProgress?: (step: string) => void;
}): Promise<StemSet>;

/** What one variant of a clip is called on disk. */
export function stemFileName(clipId: string, id: string, leadHeads: string | string[]): string;

/** Every file `separateClip` has written for a clip, read off the directory. */
export function stemFilesFor(clipId: string): Promise<string[]>;
