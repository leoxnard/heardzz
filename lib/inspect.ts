import { lookupByRelease, lookupByTrack } from "@/scripts/discogs.mjs";
import { askGemini, geminiAvailable, parseTitle } from "@/scripts/metadata.mjs";
import type { Credit } from "./types";

/* ------------------------------------------------------------------
   Working out what a video actually is.

   Split out of the inspect route because two screens now need it: the one
   that adds a record, and the one that holds a whole recording open while
   its solos are marked. Both start from a resolved video and want the same
   answer — who, what, and who was in the room.
   ------------------------------------------------------------------ */

export interface ResolvedSource {
  youtubeId: string;
  title: string;
  duration: number;
  uploader: string;
  artist: string;
  track: string;
  album: string;
  year: number;
}

export interface InspectResult {
  youtubeId: string;
  sourceTitle: string;
  sourceDuration: number;
  artist: string;
  song: string;
  album: string;
  year: number;
  personnel: Credit[];
  discogsReleaseId?: number;
  /** What each field came from, so the screen can say how sure it is. */
  notes: string[];
}

export async function inspectSource(
  source: ResolvedSource,
  discogs?: string,
): Promise<InspectResult> {
  const notes: string[] = [];

  // Music uploads sometimes carry proper tags; hand-uploaded videos never do.
  let artist = source.artist;
  let song = source.track;
  let album = source.album;
  let year = source.year;

  if (artist && song) {
    notes.push("Artist and title came from the upload's own music tags.");
  } else {
    const parsed = parseTitle(source.title, source.uploader);
    artist = parsed.artist;
    song = parsed.song;

    if (parsed.confident) {
      notes.push("Artist and title were read from the video title.");
    } else if (geminiAvailable()) {
      const guess = await askGemini({ title: source.title, uploader: source.uploader });
      if (guess?.artist && guess?.song) {
        artist = guess.artist;
        song = guess.song;
        album = album || guess.album;
        year = year || guess.year;
        notes.push("The video title had no artist in it, so Gemini read it.");
      } else {
        notes.push("The video title had no artist in it — check the name is right.");
      }
    } else {
      notes.push(
        "The video title had no artist in it, so the channel name was used. " +
          "Set GEMINI_API_KEY to have a model read these instead.",
      );
    }
  }

  // Discogs is the authority on album, year and who played.
  let personnel: Credit[] = [];
  let discogsReleaseId: number | undefined;

  if (discogs?.trim()) {
    const release = await lookupByRelease(discogs.trim(), song);
    if (release) {
      album = release.title.replace(/^.*?\s+-\s+/, "") || album;
      year = Number(release.year) || year;
      artist = artist || release.artist || "";
      personnel = release.personnel;
      discogsReleaseId = release.id;
      notes.push(`Credits came from the Discogs release you linked (${release.id}).`);
      if (release.suspect) {
        notes.push("Those credits look like a compilation's, not one session's band.");
      }
    } else {
      notes.push("That Discogs link could not be read, so the search was used instead.");
    }
  }

  if (personnel.length === 0 && artist && song) {
    const found = await lookupByTrack(artist, song);
    if (found) {
      album = album || found.title.replace(/^.*?\s+-\s+/, "");
      year = year || Number(found.year) || 0;
      personnel = found.personnel;
      discogsReleaseId = found.id;
      notes.push(`Discogs matched this to ${found.title} (${found.year}).`);
      if (found.suspect) {
        notes.push("Those credits look like a compilation's, not one session's band.");
      }
    } else {
      notes.push("Discogs found no release with this track — add a Discogs link.");
    }
  }

  return {
    youtubeId: source.youtubeId,
    sourceTitle: source.title,
    sourceDuration: source.duration,
    artist,
    song,
    album,
    year,
    personnel,
    discogsReleaseId,
    notes,
  };
}
