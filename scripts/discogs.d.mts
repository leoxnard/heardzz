export interface DiscogsCredit {
  name: string;
  role: string;
}

/**
 * How a release is billed against the artist being looked for.
 * "package" and "various" are the shapes an anthology takes.
 */
export type Billing = "exact" | "leading" | "among" | "package" | "various" | "none" | "unknown";

export interface DiscogsRelease {
  id: number;
  title: string;
  year: number | string;
  personnel: DiscogsCredit[];
  suspect: boolean;
  /** The billing on the release, as Discogs writes it. */
  artist?: string;
  billing?: Billing;
  billedAs?: string;
}

export function billingMatch(releaseTitle: string, artist: string): Billing;

export function findRelease(
  artist: string,
  album: string,
): Promise<{ id: number; title: string; year: number | string } | null>;

export function findReleaseByTrack(
  artist: string,
  song: string,
): Promise<{ id: number; title: string; year: number | string }[]>;

export function parseDiscogsUrl(input: string): { type: "release" | "master"; id: number } | null;
export function resolveMaster(masterId: number): Promise<{ id: number; title: string; year: number }>;

export function fetchPersonnel(
  releaseId: number,
  songTitle?: string,
): Promise<{ personnel: DiscogsCredit[]; suspect: boolean }>;

export function lookupPersonnel(
  artist: string,
  album: string,
  songTitle?: string,
): Promise<{ personnel: DiscogsCredit[]; release: { id: number } | null; suspect: boolean }>;

export function lookupByTrack(artist: string, song: string): Promise<DiscogsRelease | null>;
export function lookupByRelease(reference: string, song?: string): Promise<DiscogsRelease | null>;
