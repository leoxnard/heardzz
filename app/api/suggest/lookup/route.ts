import { NextResponse } from "next/server";
import { checkTools, resolveSource, resolvePlaylist } from "@/scripts/extract.mjs";
import { lookupByTrack } from "@/scripts/discogs.mjs";
import { parseTitle } from "@/scripts/metadata.mjs";
import { loadSolos } from "@/lib/library";
import { readSuggestions } from "@/lib/suggestions";
import { callerKey, take } from "@/lib/rate-limit";
import { parseYouTubeId, parseYouTubePlaylistId, watchUrl, playlistUrl } from "@/lib/youtube";
import type { Credit } from "@/lib/types";

export const dynamic = "force-dynamic";
// A playlist is one yt-dlp call plus a Discogs lookup per track.
export const maxDuration = 120;

/** As many tracks as one playlist may contribute in a single pass. */
const PLAYLIST_LIMIT = 25;
/** Discogs is polite-rate-limited; a handful at a time is plenty. */
const DISCOGS_CONCURRENCY = 4;

interface Draft {
  youtubeId: string;
  sourceTitle: string;
  sourceDuration: number;
  artist: string;
  song: string;
  album: string;
  year: number;
  personnel: Credit[];
  discogsReleaseId?: number;
  partial?: boolean;
}

/** Fill in what Discogs knows about an artist/song pair. Never throws. */
async function withCredits(draft: Draft): Promise<Draft> {
  if (!draft.artist || !draft.song) return { ...draft, partial: true };
  try {
    const found = await lookupByTrack(draft.artist, draft.song);
    if (!found) return draft;
    return {
      ...draft,
      album: draft.album || found.title.replace(/^.*?\s+-\s+/, ""),
      year: draft.year || Number(found.year) || 0,
      personnel: found.personnel,
      discogsReleaseId: found.id,
    };
  } catch {
    return draft;
  }
}

/** Run a job over each item, a few at a time, keeping the input order. */
async function mapLimit<T, R>(items: T[], limit: number, job: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await job(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Read a link for anyone who wants to put a record forward.
 *
 * This reaches the network on the server's behalf, so it is rate limited and
 * it will only look at YouTube. It reads metadata; it downloads no audio.
 * The expensive half happens when a suggestion is confirmed, behind a
 * password.
 *
 * A single video comes back as one draft. A playlist link comes back as a
 * list of them, already filtered against what the library and the pending
 * queue hold, for the sender to pick from.
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
  const playlistId = youtubeId ? null : parseYouTubePlaylistId(body.url ?? "");
  if (!youtubeId && !playlistId) {
    return NextResponse.json({ error: "badLink" }, { status: 400 });
  }

  const [solos, { suggestions }] = await Promise.all([loadSolos(), readSuggestions()]);
  const known = new Set<string>([
    ...solos.map((solo) => solo.youtubeId),
    ...suggestions.filter((s) => s.status === "pending").map((s) => s.youtubeId),
  ]);

  if (playlistId) return playlist(playlistId, known);

  if (solos.some((solo) => solo.youtubeId === youtubeId)) {
    return NextResponse.json({ error: "alreadyHere" }, { status: 409 });
  }
  if (suggestions.some((s) => s.youtubeId === youtubeId && s.status === "pending")) {
    return NextResponse.json({ error: "alreadyPending" }, { status: 409 });
  }

  try {
    await checkTools();
    const source = await resolveSource(watchUrl(youtubeId!));

    let artist = source.artist;
    let song = source.track;

    if (!artist || !song) {
      const parsed = parseTitle(source.title, source.uploader);
      artist = artist || parsed.artist;
      song = song || parsed.song;
    }

    const draft = await withCredits({
      youtubeId: youtubeId!,
      sourceTitle: source.title,
      sourceDuration: source.duration,
      artist,
      song,
      album: source.album,
      year: source.year,
      personnel: [],
    });

    return NextResponse.json({ ...draft, partial: undefined });
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

async function playlist(playlistId: string, known: Set<string>) {
  let entries;
  try {
    await checkTools();
    entries = await resolvePlaylist(playlistUrl(playlistId), PLAYLIST_LIMIT);
  } catch {
    return NextResponse.json({ error: "badPlaylist" }, { status: 400 });
  }

  const fresh = entries.filter((entry) => !known.has(entry.youtubeId));
  const skipped = entries.length - fresh.length;

  if (!fresh.length) {
    return NextResponse.json({ error: "playlistAllKnown" }, { status: 409 });
  }

  const drafts = await mapLimit(fresh, DISCOGS_CONCURRENCY, async (entry) => {
    const parsed = parseTitle(entry.title, entry.uploader);
    return withCredits({
      youtubeId: entry.youtubeId,
      sourceTitle: entry.title,
      sourceDuration: entry.duration,
      artist: parsed.artist,
      song: parsed.song,
      album: "",
      year: 0,
      personnel: [],
    });
  });

  return NextResponse.json({
    playlist: true,
    playlistId,
    skipped,
    // Whether the list was cut short, so the form can say so.
    truncated: entries.length >= PLAYLIST_LIMIT,
    entries: drafts,
  });
}
