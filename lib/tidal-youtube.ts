import { artistKey, songKey } from "./duplicates";
import { normalize } from "./lexicon";
import type { Candidate } from "./tidal-candidates";

/* ------------------------------------------------------------------
   Deciding whether a search hit is actually the record.

   This is the risky join in the whole feature. TIDAL knows what the
   recording is; YouTube is where the audio has to come from; and nothing
   connects them but a phrase typed into a search box. The first hit for
   "Charlie Parker Now's The Time" is as likely to be a live take, a
   student transcription, a cover, a full-album upload or an hour of "jazz
   for studying" as it is to be the record.

   A wrong hit is worse here than a missing one. The clip a player hears is
   half a second of the opening, so a wrong upload is not a slightly-off
   answer — it is an unanswerable round, and it lands in the library
   unverified where nobody is looking. So this refuses by default and
   accepts only on evidence:

   the duration has to match what TIDAL says (a cover or a live take almost
   never lands inside the window, and a full-album upload misses it by an
   order of magnitude); the title has to contain the tune; and something
   has to name the artist.

   `- Topic` channels are preferred where they exist. They are the
   label-delivered uploads: one track, no intro, no talking, and the
   duration is the record's.
   ------------------------------------------------------------------ */

export interface SearchHit {
  youtubeId: string;
  title: string;
  duration: number;
  uploader: string;
  artist: string;
  track: string;
  album: string;
  year: number;
}

export interface Match {
  hit: SearchHit;
  score: number;
  topic: boolean;
}

export interface Rejection {
  youtubeId: string;
  title: string;
  duration: number;
  reason: string;
}

export interface Resolution {
  candidate: Candidate;
  match: Match | null;
  rejected: Rejection[];
}

/**
 * How far a hit's length may sit from TIDAL's before it stops being the same
 * recording. Proportional, because eight seconds is generous on a two-minute
 * side and far too tight on a twelve-minute one, but clamped at both ends:
 * a remaster drifts by a second or two, a different take by much more.
 */
function tolerance(expected: number): number {
  return Math.min(15, Math.max(6, expected * 0.05));
}

function isTopic(uploader: string): boolean {
  return /\s-\s*topic$/i.test(uploader.trim());
}

/**
 * Everything the upload says about itself, folded once. The artist is looked
 * for across all of it because which field carries it varies: a Topic upload
 * tags it, a hand-made one only says it in the title or the channel name.
 */
function haystack(hit: SearchHit): string {
  return normalize([hit.title, hit.uploader, hit.artist, hit.album].join(" "));
}

export function judge(candidate: Candidate, hit: SearchHit): { ok: true; match: Match } | { ok: false; reason: string } {
  const expected = candidate.durationSec;

  if (!hit.duration) {
    return { ok: false, reason: "no duration (livestream or unavailable)" };
  }
  if (expected !== null) {
    const drift = Math.abs(hit.duration - expected);
    if (drift > tolerance(expected)) {
      return { ok: false, reason: `runs ${hit.duration}s, expected ${expected}s` };
    }
  }

  const song = songKey(candidate.song);
  if (song && !normalize(hit.title).includes(song)) {
    return { ok: false, reason: "title does not name the tune" };
  }

  const artist = artistKey(candidate.artist);
  if (artist && !haystack(hit).includes(artist)) {
    return { ok: false, reason: "nothing names the artist" };
  }

  /*
   * Everything below has already passed. The score only orders the survivors,
   * so it is deliberately crude: prefer a Topic upload, then the one whose
   * length sits closest to TIDAL's.
   */
  const topic = isTopic(hit.uploader);
  const drift = expected === null ? 0 : Math.abs(hit.duration - expected);
  const score = (topic ? 100 : 0) + (hit.track ? 10 : 0) + Math.max(0, 20 - drift);

  return { ok: true, match: { hit, score, topic } };
}

/** The best hit for a candidate, and why each of the others went. */
export function pickBest(candidate: Candidate, hits: SearchHit[]): Resolution {
  const matches: Match[] = [];
  const rejected: Rejection[] = [];

  for (const hit of hits) {
    const verdict = judge(candidate, hit);
    if (verdict.ok) matches.push(verdict.match);
    else {
      rejected.push({
        youtubeId: hit.youtubeId,
        title: hit.title,
        duration: hit.duration,
        reason: verdict.reason,
      });
    }
  }

  matches.sort((a, b) => b.score - a.score);
  return { candidate, match: matches[0] ?? null, rejected };
}

/** The phrase handed to YouTube. Plain words: quoting narrows it to nothing. */
export function searchPhrase(candidate: Candidate): string {
  return `${candidate.artist} ${candidate.song}`;
}
