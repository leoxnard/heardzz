import { NextResponse } from "next/server";
import { generateText, Output } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { z } from "zod";
import { callerKey, take } from "@/lib/rate-limit";
import { tidalAvailable, tidalUnavailableReason } from "@/lib/tidal";
import { resolveArtistNames } from "@/lib/taste-text";
import { tasteFromArtistIds } from "@/lib/taste";

/**
 * Called direct rather than through the AI Gateway: this deployment already
 * carries its own Gemini key, and the gateway's default env var
 * (`AI_GATEWAY_API_KEY`) is a second credential nobody asked for.
 */
const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY });

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Same door as `/api/foryou/plan`, held to the same width: reading a taste
 * is cheap on its own, but it is what a sitting's downloads are spent
 * against.
 */
const READS = 8;
const READ_WINDOW_MS = 60 * 60 * 1000;

/** Enough names to widen out from without asking the model to name every act in a genre. */
const MAX_ARTISTS = 8;

const taste = z.object({
  artists: z
    .array(z.string())
    .max(MAX_ARTISTS)
    .describe(
      "Musician or band names to build the taste from — either named directly by the " +
        "listener, or, when they described a genre/style/era/mood instead, several artists " +
        "well known for it.",
    ),
});

/**
 * Read a list of artists out of a few words of taste — named directly, or
 * stood in for when the words describe a style rather than an act.
 *
 * Everything past this point only knows how to widen out from an artist id
 * (`tasteFromArtistIds`), and TIDAL has no notion of "genre" this app can
 * ask it for (`lib/tidal.ts`) — so "hard bop" has to become a handful of
 * hard bop musicians before it can go anywhere. The model is trusted for
 * that translation and nothing past it: what comes back is still just
 * names, resolved the same way a typed one would be.
 */
async function namesFrom(text: string): Promise<string[]> {
  const { output } = await generateText({
    model: google("gemini-3.8-flash"),
    output: Output.object({ schema: taste }),
    prompt:
      "A listener typed the following to describe the jazz they want to hear:\n\n" +
      `"${text}"\n\n` +
      "If they named specific musicians or bands, list those. If instead they described " +
      "a genre, style, era, mood or instrument (e.g. \"hard bop\", \"something moody\", " +
      `\"60s Blue Note\", \"tenor sax\"), list ${MAX_ARTISTS} artists strongly representative ` +
      "of that description instead — real, well-known acts, not a guess at an obscure one. " +
      "If the text names nobody and describes nothing musical, return an empty list.",
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
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY is not set." },
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
        { error: "Name an artist, a band, or a style, and try again." },
        { status: 400 },
      );
    }

    const resolved = await resolveArtistNames(names);
    if (resolved.length === 0) {
      return NextResponse.json(
        { error: "TIDAL doesn't have anyone that came out of that." },
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
