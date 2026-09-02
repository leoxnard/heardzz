import { NextResponse } from "next/server";
import { generateText, Output } from "ai";
import { z } from "zod";
import { callerKey, take } from "@/lib/rate-limit";
import { tidalAvailable, tidalUnavailableReason } from "@/lib/tidal";
import { resolveArtistNames } from "@/lib/taste-text";
import { tasteFromArtistIds } from "@/lib/taste";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Same door as `/api/foryou/plan`, held to the same width: reading a taste
 * is cheap on its own, but it is what a sitting's downloads are spent
 * against.
 */
const READS = 8;
const READ_WINDOW_MS = 60 * 60 * 1000;

/** Nobody is naming a tenth favourite artist in one line. */
const MAX_ARTISTS = 6;

const taste = z.object({
  artists: z
    .array(z.string())
    .max(MAX_ARTISTS)
    .describe("Musician or band names the listener named, exactly as they wrote them."),
});

/**
 * Read the artist names out of a few words of taste.
 *
 * Deliberately narrow: a mood, a genre or an instrument on its own is not
 * something the rest of this pipeline can act on, since everything past
 * this point only knows how to widen out from an artist id. So the model is
 * asked for names and nothing else, and "no names" comes back as an empty
 * list rather than a guess.
 */
async function namesFrom(text: string): Promise<string[]> {
  const { output } = await generateText({
    model: "google/gemini-3.8-flash",
    output: Output.object({ schema: taste }),
    prompt:
      "A listener typed the following to describe the jazz they want to hear:\n\n" +
      `"${text}"\n\n` +
      "List the specific musicians or bands they named. Do not include genres, " +
      "moods, instruments, decades, or anything that is not an act's own name. " +
      "If they named nobody in particular, return an empty list.",
  });
  return output.artists.map((name) => name.trim()).filter(Boolean).slice(0, MAX_ARTISTS);
}

/**
 * Read a taste out of a few words instead of a pasted link.
 *
 * TIDAL cannot be searched by name (`lib/tidal.ts`), so a name typed here
 * has to be read by a model, then placed against TIDAL by way of
 * MusicBrainz (`lib/taste-text.ts`) before anything below this can widen out
 * from it the way `/api/foryou/plan` widens out from a link.
 */
export async function POST(request: Request) {
  if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
    return NextResponse.json(
      { error: "AI_GATEWAY_API_KEY is not set." },
      { status: 400 },
    );
  }
  if (!tidalAvailable()) {
    return NextResponse.json({ error: tidalUnavailableReason() }, { status: 400 });
  }

  const body = (await request.json()) as { text?: string };
  const text = (body.text ?? "").trim();
  if (!text) {
    return NextResponse.json({ error: "Say who you want to hear." }, { status: 400 });
  }

  const limit = take(`foryou-text:${callerKey(request)}`, READS, READ_WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many sittings. Try again in ${Math.ceil(limit.retryAfter / 60)} minutes.` },
      { status: 429 },
    );
  }

  try {
    const names = await namesFrom(text);
    if (names.length === 0) {
      return NextResponse.json(
        { error: "Name an artist or two and try again." },
        { status: 400 },
      );
    }

    const resolved = await resolveArtistNames(names);
    if (resolved.length === 0) {
      return NextResponse.json(
        { error: "TIDAL doesn't have anyone by that name." },
        { status: 400 },
      );
    }

    const source = resolved.map((artist) => artist.name).join(", ");
    const result = await tasteFromArtistIds(resolved.map((a) => a.id), source);
    if (result.candidates.length === 0) {
      return NextResponse.json(
        { error: "Nothing well enough known came out of that taste." },
        { status: 400 },
      );
    }

    return NextResponse.json({
      source,
      reached: result.reached,
      candidates: result.candidates,
      /*
       * Stands in for the pasted link a replan of this sitting would
       * otherwise carry — `parseTidalRef` reads a comma-joined id list back
       * into the same ids this request just resolved.
       */
      target: resolved.map((a) => a.id).join(","),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not read that" },
      { status: 500 },
    );
  }
}
