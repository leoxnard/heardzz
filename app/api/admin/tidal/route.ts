import { NextResponse } from "next/server";
import { checkTools, searchCandidates } from "@/scripts/extract.mjs";
import { requireAdmin } from "@/lib/admin-guard";
import { parseTidalRef, tidalAvailable, tidalUnavailableReason, trackArtists } from "@/lib/tidal";
import { candidatesForArtist } from "@/lib/tidal-candidates";
import { pickBest, searchPhrase, type SearchHit } from "@/lib/tidal-youtube";

export const dynamic = "force-dynamic";
/** A TIDAL lookup and a dozen yt-dlp searches. Slow, but nothing downloads. */
export const maxDuration = 300;

/**
 * How many of an artist's tunes to look for. Each one is a yt-dlp search, and
 * the list is sorted by popularity, so the tail is both the slowest part of
 * the request and the least worth having.
 */
const LIMIT = 12;

/**
 * Turn a TIDAL artist into a queue of YouTube records.
 *
 * The answer is deliberately the same shape `/api/admin/playlist` returns, so
 * everything downstream — the marking queue, the unattended run, the duplicate
 * check inside `playlist/auto` — treats a TIDAL seed exactly like a pasted
 * playlist. This route only decides *which* records; it fetches nothing.
 *
 * Rejections are reported rather than swallowed. A thin list should be
 * explainable — "nine of these were live takes" is useful, a short list with
 * no reason given is not.
 */
export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  if (!tidalAvailable()) {
    return NextResponse.json({ error: tidalUnavailableReason() }, { status: 400 });
  }

  const body = (await request.json()) as { target?: string };
  const ref = parseTidalRef(body.target ?? "");
  if (!ref) {
    return NextResponse.json(
      { error: "That is not a TIDAL artist or track link." },
      { status: 400 },
    );
  }

  try {
    await checkTools();

    let artistId = ref.id;
    if (ref.kind === "track") {
      const [credited] = await trackArtists(ref.id);
      if (!credited) {
        return NextResponse.json({ error: "That track has no artist on it." }, { status: 400 });
      }
      artistId = credited.id;
    }

    const report = await candidatesForArtist(artistId);
    if (!report) {
      return NextResponse.json({ error: "TIDAL has no such artist." }, { status: 404 });
    }
    if (report.candidates.length === 0) {
      return NextResponse.json(
        {
          error:
            report.skipped.alreadyInLibrary > 0
              ? "Everything TIDAL lists for that artist is already in the library."
              : "TIDAL lists nothing playable for that artist.",
        },
        { status: 400 },
      );
    }

    const entries: {
      youtubeId: string;
      title: string;
      duration: number;
      uploader: string;
      isrc?: string;
      tidalArtistId: string;
      artist: string;
      song: string;
    }[] = [];
    const misses: { song: string; reason: string }[] = [];
    const seen = new Set<string>();

    for (const candidate of report.candidates.slice(0, LIMIT)) {
      let hits: SearchHit[] = [];
      try {
        hits = (await searchCandidates(searchPhrase(candidate), 5)) as SearchHit[];
      } catch {
        misses.push({ song: candidate.song, reason: "YouTube search failed" });
        continue;
      }

      const { match, rejected } = pickBest(candidate, hits);
      if (!match) {
        misses.push({
          song: candidate.song,
          reason: rejected[0]?.reason ?? "nothing came back",
        });
        continue;
      }
      // Two tunes can resolve to one upload — an album side, usually.
      if (seen.has(match.hit.youtubeId)) continue;
      seen.add(match.hit.youtubeId);

      entries.push({
        youtubeId: match.hit.youtubeId,
        title: match.hit.title,
        duration: match.hit.duration,
        uploader: match.hit.uploader,
        // Written onto the entry so the library keeps an identifier that
        // means something outside it, rather than only a YouTube upload.
        isrc: candidate.isrc ?? undefined,
        tidalArtistId: candidate.tidalArtistId,
        /*
         * TIDAL's names, not the upload's. An upload is tagged from whatever
         * sleeve its maker had, and "Louis Armstrong And The All-Stars" is an
         * answer no player is going to type.
         */
        artist: candidate.artist,
        song: candidate.song,
      });
    }

    if (entries.length === 0) {
      return NextResponse.json(
        { error: "Nothing TIDAL lists for that artist could be matched on YouTube." },
        { status: 400 },
      );
    }

    return NextResponse.json({
      entries,
      known: report.skipped.alreadyInLibrary,
      artist: report.artist,
      misses,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not read that artist" },
      { status: 500 },
    );
  }
}
