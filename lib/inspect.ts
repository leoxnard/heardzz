import { lookupByRelease, lookupByTrack, type Billing } from "@/scripts/discogs.mjs";
import { askGemini, geminiAvailable, parseTitle } from "@/scripts/metadata.mjs";
import { cleanName } from "./clean";
import { artistKey, songKey } from "./duplicates";
import { ARTISTS, SONGS } from "./lexicon";
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
  /**
   * How the Discogs release that supplied the credits is billed against the
   * artist. Anything but "exact" or "leading" means the credits may belong
   * to a package of sessions rather than to this one, and the screen says so.
   */
  billing?: Billing;
  /** The billing as Discogs writes it, when it is not the artist we have. */
  billedAs?: string;
  /** What each field came from, so the screen can say how sure it is. */
  notes: string[];
}

/**
 * What a billing means, in a sentence, when it is worth saying anything.
 *
 * "exact" and "leading" are the normal cases and say nothing. The rest are
 * the ways a lookup lands on an anthology, which is how a sextet turns into
 * a list of every horn player of the decade.
 */
const BILLING_NOTE: Partial<Record<Billing, string>> = {
  among: "That release bills several artists and this one is not the lead — the credits may be a package's, not this session's.",
  package: "That release is billed to three or more artists at once, which is what a label calls a set of different sessions. Check the band, or paste the right Discogs release.",
  various: "That release is a Various Artists compilation. Its credits are everyone on it, not the band on this date.",
  none: "That release is not billed to this artist at all. Paste a Discogs release if the band looks wrong.",
};

/** Folded once at module load; every record checked against the same sets. */
const KNOWN_ARTIST_KEYS = new Set(ARTISTS.map(artistKey));
const KNOWN_SONG_KEYS = new Set(SONGS.map(songKey));

export async function inspectSource(
  source: ResolvedSource,
  discogs?: string,
): Promise<InspectResult> {
  const notes: string[] = [];

  // Music uploads sometimes carry proper tags; hand-uploaded videos never do.
  // Everything here goes through cleanName: an upload's own tags carry
  // "(Remastered 2011)" as cheerfully as its title does.
  let artist = cleanName(source.artist);
  let song = cleanName(source.track);
  let album = cleanName(source.album);
  let year = source.year;

  if (artist && song) {
    notes.push("Artist and title came from the upload's own music tags.");
  } else {
    const parsed = parseTitle(source.title, source.uploader);
    artist = cleanName(parsed.artist);
    song = cleanName(parsed.song);

    if (parsed.confident) {
      notes.push("Artist and title were read from the video title.");
    } else if (geminiAvailable()) {
      const guess = await askGemini({ title: source.title, uploader: source.uploader });
      if (guess?.artist && guess?.song) {
        artist = cleanName(guess.artist);
        song = cleanName(guess.song);
        album = album || cleanName(guess.album);
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

  /*
   * Some uploaders write "Title - Artist" instead of "Artist - Title", and a
   * parser that always takes the second half as the tune gets those
   * backwards: "So What - Miles Davis" comes back with the tune in the
   * artist field, which is a record no duplicate check ever finds, because
   * the record it actually names is filed correctly.
   *
   * Caught against the two lexicons rather than guessed at: a swap is only
   * made when the artist field is a known tune, the artist field is *not* a
   * known artist, and the song field *is* a known artist — so a genuine
   * "Artist - Title" pair that merely shares a word with something else is
   * left alone. Folded through the same artistKey/songKey duplicate
   * matching uses, so "The Miles Davis Quintet" is recognised as "Miles
   * Davis" here exactly as it would be when checking for a duplicate.
   */
  if (artist && song) {
    const artistIsKnownSong = KNOWN_SONG_KEYS.has(songKey(artist));
    const artistIsKnownArtist = KNOWN_ARTIST_KEYS.has(artistKey(artist));
    const songIsKnownArtist = KNOWN_ARTIST_KEYS.has(artistKey(song));

    if (artistIsKnownSong && !artistIsKnownArtist && songIsKnownArtist) {
      [artist, song] = [song, artist];
      notes.push("The title looked like it named the tune before the artist, so the two were swapped.");
    }
  }

  // Discogs is the authority on album, year and who played.
  let personnel: Credit[] = [];
  let discogsReleaseId: number | undefined;
  let billing: Billing | undefined;
  let billedAs: string | undefined;

  if (discogs?.trim()) {
    const release = await lookupByRelease(discogs.trim(), song);
    if (release) {
      album = cleanName(release.title.replace(/^.*?\s+-\s+/, "")) || album;
      year = Number(release.year) || year;
      artist = artist || release.artist || "";
      personnel = release.personnel;
      discogsReleaseId = release.id;
      billing = release.billing;
      billedAs = release.billedAs ?? release.artist;
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
      /*
       * Discogs outranks the upload's own tags on album and year.
       *
       * A YouTube tag names whichever release the uploader ripped, which is
       * routinely a sampler or a decades-later reissue: an "Ellington
       * Uptown" track uploaded from a 2006 compilation is tagged with the
       * compilation and the year 2006, and the sleeve the game shows is
       * meant to be the record the music came out on. Only a release billed
       * to this artist and crediting one session gets to overrule a tag —
       * anything vaguer is exactly the wrong pressing this is guarding
       * against, and the tag stays.
       */
      const trustworthy =
        !found.suspect && (found.billing === "exact" || found.billing === "leading");
      const discogsAlbum = cleanName(found.title.replace(/^.*?\s+-\s+/, ""));
      const discogsYear = Number(found.year) || 0;

      album = trustworthy ? discogsAlbum || album : album || discogsAlbum;
      year = trustworthy ? discogsYear || year : year || discogsYear;
      personnel = found.personnel;
      discogsReleaseId = found.id;
      billing = found.billing;
      billedAs = found.artist;
      notes.push(`Discogs matched this to ${found.title} (${found.year}).`);
      const warning = billing ? BILLING_NOTE[billing] : undefined;
      if (warning) notes.push(warning);
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
    billing,
    billedAs,
    notes,
  };
}
