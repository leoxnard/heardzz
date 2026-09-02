/* ------------------------------------------------------------------
   Turning a YouTube video into artist and title.

   Two passes. The first is a parser, because uploaders overwhelmingly
   write "Artist - Title" and a parser costs nothing, never rate-limits
   and cannot invent a record that does not exist. The second is a model
   call, used only when the parser has nothing to go on, and only when a
   key has been provided.
   ------------------------------------------------------------------ */

/**
 * Bracketed asides.
 *
 * Every one of them goes, not only the ones naming a remaster or a codec:
 * nothing a bracket has ever contained on YouTube is part of the name of a
 * tune, and leaving a bracket in means "So What (Remastered 2011)" never
 * matches the "So What" already in the library. Mirrors `cleanName` in
 * lib/clean.ts, which is the same rule for everything downstream of here.
 */
const NOISE = /[([{][^)\]}]*[)\]}]/g;

/** A bracket opened and never closed — the tail is an aside too. */
const UNCLOSED = /[([{][^)\]}]*$/;

/** Suffixes channels add to their own name. */
const CHANNEL_NOISE = /\s*[-–—]?\s*(topic|vevo|official|music|records|jazz)\s*$/i;

/**
 * The same asides as NOISE, minus the brackets some uploaders forget to
 * type. "So What HQ", "Naima Full Album", "My Favorite Things Official
 * Audio" all trail one of these with nothing around it, and a title that
 * ends in one loses it the same way it would lose "(HQ)" — anchored to the
 * end, so a tune that is genuinely one of these words is never touched.
 */
const TRAILING_NOISE =
  /\s+(HQ|HD|4K|8K|SD|remaster(?:ed)?(?:\s*\d{4})?|official(?:\s*(?:audio|video))?|full\s*album|album\s*version|audio|video|lyrics|visualizer)\s*$/i;

const SEPARATORS = /\s+[-–—|:]\s+/;

function tidy(value) {
  const raw = String(value || "");
  let stripped = raw.replace(NOISE, " ").replace(UNCLOSED, " ");
  // Applied until nothing more matches: "Naima HQ Audio" sheds one tag at a
  // time, "Audio" first and then "HQ".
  let prior;
  do {
    prior = stripped;
    stripped = stripped.replace(TRAILING_NOISE, "");
  } while (stripped !== prior);
  // Stripping never empties a name: a video titled only "(Live)" keeps the
  // words it had rather than becoming a blank field.
  return edges(stripped) || edges(raw);
}

function edges(value) {
  return value
    .replace(/\s{2,}/g, " ")
    .replace(/^["'\s\-–—·|:,;]+|["\s\-–—·|:,;]+$/g, "")
    .trim();
}

/**
 * Best guess at who and what, from the title and the channel.
 *
 * `confident` says whether the title actually carried a separator. When it
 * did not, the channel name is standing in for the artist, which is right
 * often enough to offer and wrong often enough to flag.
 */
export function parseTitle(title, uploader) {
  const cleanTitle = tidy(title);
  const channel = tidy(String(uploader || "").replace(CHANNEL_NOISE, ""));

  const parts = cleanTitle.split(SEPARATORS).map(tidy).filter(Boolean);

  // "Artist - Song - Album" and "Artist - Song | Label" are both common, and
  // a song title that genuinely contains a dash is not. Take the second part.
  if (parts.length >= 2) {
    return { artist: parts[0], song: parts[1], confident: true };
  }

  return { artist: channel, song: cleanTitle, confident: false };
}

/* ------------------------------------------------------------------
   Optional model pass
   ------------------------------------------------------------------ */

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

export const geminiAvailable = () => Boolean(process.env.GEMINI_API_KEY);

/**
 * Ask Gemini to read a video title the way a person would.
 *
 * Returns null on any failure — a missing key, a refusal, a rate limit, a
 * reply that is not the JSON that was asked for. The caller always has the
 * parser's answer to fall back on, so this is allowed to simply not work.
 */
export async function askGemini({ title, uploader, description }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;

  const prompt = [
    "You are reading the metadata of a YouTube upload of a jazz recording.",
    "Identify the recording. Reply with JSON only, no prose, no code fence:",
    '{"artist":"","song":"","album":"","year":0}',
    "",
    "artist is the name the record was released under (the bandleader or group),",
    "not whoever takes the solo. song is the tune. album and year are the original",
    "release, not a reissue. Use \"\" and 0 for anything you are not sure of;",
    "do not guess.",
    "",
    `Title: ${title}`,
    `Channel: ${uploader || "unknown"}`,
    description ? `Description: ${String(description).slice(0, 1200)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, responseMimeType: "application/json" },
        }),
      },
    );

    if (!response.ok) return null;

    const body = await response.json();
    const text = body?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;

    const parsed = JSON.parse(text);
    return {
      artist: String(parsed.artist || "").trim(),
      song: String(parsed.song || "").trim(),
      album: String(parsed.album || "").trim(),
      year: Number(parsed.year) || 0,
    };
  } catch {
    return null;
  }
}
