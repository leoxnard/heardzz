/* ------------------------------------------------------------------
   Turning a YouTube video into artist and title.

   Two passes. The first is a parser, because uploaders overwhelmingly
   write "Artist - Title" and a parser costs nothing, never rate-limits
   and cannot invent a record that does not exist. The second is a model
   call, used only when the parser has nothing to go on, and only when a
   key has been provided.
   ------------------------------------------------------------------ */

/** Bracketed asides that describe the upload rather than the music. */
const NOISE =
  /\s*[([]\s*[^)\]]*(official|audio|video|hd|hq|4k|full album|remaster|remastered|edition|mono|stereo|lyrics|visualizer|topic|reissue|digitally|restored|colou?r|version|bonus|explicit|clean|album stream)[^)\]]*\s*[)\]]/gi;

/** Suffixes channels add to their own name. */
const CHANNEL_NOISE = /\s*[-–—]?\s*(topic|vevo|official|music|records|jazz)\s*$/i;

const SEPARATORS = /\s+[-–—|:]\s+/;

function tidy(value) {
  return String(value || "")
    .replace(NOISE, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^["'\s]+|["'\s.,-]+$/g, "")
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
