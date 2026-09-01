import { NextResponse } from "next/server";
import { checkTools, resolveSource } from "@/scripts/extract.mjs";
import { lookupByTrack } from "@/scripts/discogs.mjs";
import { parseTitle } from "@/scripts/metadata.mjs";
import { loadSolos } from "@/lib/library";
import { readSuggestions } from "@/lib/suggestions";
import { callerKey, take } from "@/lib/rate-limit";
import { parseYouTubeId, watchUrl } from "@/lib/youtube";
import type { Credit } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Read a link for anyone who wants to put a record forward.
 *
 * This reaches the network on the server's behalf, so it is rate limited and
 * it will only look at YouTube. It reads metadata; it downloads no audio.
 * The expensive half happens when a suggestion is confirmed, behind a
 * password.
 */
export async function POST(request: Request) {
  const limit = take(`lookup:${callerKey(request)}`, 20, 10 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many lookups. Try again in ${limit.retryAfter} seconds.` },
      { status: 429 },
    );
  }

  const body = (await request.json()) as { url?: string };
  const youtubeId = parseYouTubeId(body.url ?? "");
  if (!youtubeId) {
    return NextResponse.json({ error: "badLink" }, { status: 400 });
  }

  const [solos, { suggestions }] = await Promise.all([loadSolos(), readSuggestions()]);

  if (solos.some((solo) => solo.youtubeId === youtubeId)) {
    return NextResponse.json({ error: "alreadyHere" }, { status: 409 });
  }
  if (suggestions.some((s) => s.youtubeId === youtubeId && s.status === "pending")) {
    return NextResponse.json({ error: "alreadyPending" }, { status: 409 });
  }

  try {
    await checkTools();
    const source = await resolveSource(watchUrl(youtubeId));

    let artist = source.artist;
    let song = source.track;
    let album = source.album;
    let year = source.year;

    if (!artist || !song) {
      const parsed = parseTitle(source.title, source.uploader);
      artist = artist || parsed.artist;
      song = song || parsed.song;
    }

    let personnel: Credit[] = [];
    let discogsReleaseId: number | undefined;

    if (artist && song) {
      const found = await lookupByTrack(artist, song);
      if (found) {
        album = album || found.title.replace(/^.*?\s+-\s+/, "");
        year = year || Number(found.year) || 0;
        personnel = found.personnel;
        discogsReleaseId = found.id;
      }
    }

    return NextResponse.json({
      youtubeId,
      sourceTitle: source.title,
      sourceDuration: source.duration,
      artist,
      song,
      album,
      year,
      personnel,
      discogsReleaseId,
    });
  } catch {
    // A dead video, a private one, a yt-dlp that has fallen behind. The form
    // still lets the fields be filled in by hand.
    return NextResponse.json({
      youtubeId,
      sourceTitle: "",
      sourceDuration: 0,
      artist: "",
      song: "",
      album: "",
      year: 0,
      personnel: [],
      partial: true,
    });
  }
}
