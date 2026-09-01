import { NextResponse } from "next/server";
import { checkTools, resolveSource } from "@/scripts/extract.mjs";
import { lookupByRelease, lookupByTrack } from "@/scripts/discogs.mjs";
import { askGemini, geminiAvailable, parseTitle } from "@/scripts/metadata.mjs";
import { blockedInProduction } from "@/lib/admin-guard";
import type { Credit } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface InspectBody {
  /** A YouTube URL, or a search phrase. */
  target: string;
  /** Optional: a Discogs release or master URL, which wins over the search. */
  discogs?: string;
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

export async function POST(request: Request) {
  const blocked = blockedInProduction();
  if (blocked) return blocked;

  const body = (await request.json()) as InspectBody;
  if (!body.target?.trim()) {
    return NextResponse.json({ error: "Paste a YouTube link first" }, { status: 400 });
  }

  try {
    await checkTools();
    const notes: string[] = [];

    const source = await resolveSource(body.target.trim());

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

    if (body.discogs?.trim()) {
      const release = await lookupByRelease(body.discogs.trim(), song);
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

    const result: InspectResult = {
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

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Lookup failed" },
      { status: 500 },
    );
  }
}
