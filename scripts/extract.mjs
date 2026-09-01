/* ------------------------------------------------------------------
   Clip extraction. Shared by the CLI and by the admin import route so
   there is exactly one implementation of the pipeline.

   yt-dlp pulls the source audio, ffmpeg cuts a window around the solo and
   normalises its loudness so no clip is conspicuously louder than the rest.

   The window carries PRE_ROLL seconds ahead of the stated solo entry. That
   headroom is what lets the admin screen drag the entry point earlier or
   later without going back to the network.
   ------------------------------------------------------------------ */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const run = promisify(execFile);

export const PRE_ROLL = 8;
export const POST_ROLL = 32;
export const CLIP_LENGTH = PRE_ROLL + POST_ROLL;

export const AUDIO_DIR = path.join(process.cwd(), "public", "audio");
export const LIBRARY_PATH = path.join(process.cwd(), "data", "solos.json");

export function slugify(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Accepts "2:14", "1:02:30" or plain seconds. */
export function parseTimecode(value) {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  const parts = String(value).trim().split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`Cannot read timecode "${value}"`);
  }
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

export function formatTimecode(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

async function which(bin) {
  try {
    await run("which", [bin]);
    return true;
  } catch {
    return false;
  }
}

export async function checkTools() {
  const missing = [];
  if (!(await which("yt-dlp"))) missing.push("yt-dlp");
  if (!(await which("ffmpeg"))) missing.push("ffmpeg");
  if (missing.length) {
    throw new Error(
      `Missing required tools: ${missing.join(", ")}. Install with: brew install ${missing.join(" ")}`,
    );
  }
}

/**
 * Resolve a search phrase or URL to a single video without downloading.
 * Doing this first means a bad match is caught before any bytes move.
 */
export async function resolveSource(target) {
  const query = /^https?:\/\//.test(target) ? target : `ytsearch1:${target}`;
  const { stdout } = await run(
    "yt-dlp",
    [
      "--no-playlist",
      "--skip-download",
      "--no-warnings",
      "--print",
      "%(id)s\t%(title)s\t%(duration)s\t%(uploader)s",
      query,
    ],
    { maxBuffer: 1024 * 1024 * 8 },
  );

  const [id, title, duration, uploader] = stdout.trim().split("\n")[0].split("\t");
  if (!id) throw new Error(`No video found for "${target}"`);
  return { youtubeId: id, title, duration: Number(duration) || 0, uploader };
}

/**
 * Download, cut and normalise. Returns the numbers the library entry needs.
 */

/**
 * YouTube's throttling changes often, and yt-dlp answers it by rotating which
 * client it impersonates. The default is right almost always; the fallbacks
 * cover the window between a YouTube change and the next yt-dlp release.
 *
 * yt-dlp's own stderr is carried into the thrown error — swallowing it once
 * cost an entire seeding run that reported twenty identical useless failures.
 */
const CLIENT_FALLBACKS = [null, "android_vr", "web_embedded", "tv_simply"];

async function download(youtubeId, work) {
  const failures = [];

  for (const client of CLIENT_FALLBACKS) {
    const args = [
      "--no-playlist",
      "--no-warnings",
      "-f", "bestaudio/best",
      "-x",
      "--audio-format", "wav",
      "--audio-quality", "0",
      "-o", path.join(work, "source.%(ext)s"),
    ];
    if (client) args.push("--extractor-args", `youtube:player_client=${client}`);
    args.push(`https://www.youtube.com/watch?v=${youtubeId}`);

    try {
      await run("yt-dlp", args, { maxBuffer: 1024 * 1024 * 16 });
      return;
    } catch (error) {
      const stderr = String(error.stderr || error.message)
        .split("\n")
        .filter((line) => /error/i.test(line))
        .join(" ")
        .trim();
      failures.push(`${client ?? "default"}: ${stderr || "unknown failure"}`);
    }
  }

  throw new Error(
    `yt-dlp could not fetch ${youtubeId}. ${failures.join(" | ")}. ` +
      `If every client failed, yt-dlp is probably behind a YouTube change — try: brew upgrade yt-dlp`,
  );
}

export async function extractClip({ youtubeId, soloStart, outputId, onProgress }) {
  const log = onProgress ?? (() => {});
  const work = await mkdtemp(path.join(tmpdir(), "heardzz-"));

  try {
    log("downloading source audio");
    const source = path.join(work, "source.wav");
    await download(youtubeId, work);

    if (!existsSync(source)) {
      throw new Error("yt-dlp finished but produced no audio file");
    }

    // "opening" resolves against the audio we just fetched, so finding the
    // downbeat costs no extra download.
    const resolvedStart =
      soloStart === "opening" ? await detectAudibleStart(source) : Number(soloStart);

    // Clamp the pre-roll when the start sits near the top of the recording,
    // and report back how much of it actually survived.
    const leadIn = Math.min(PRE_ROLL, resolvedStart);
    const cutStart = Math.max(0, resolvedStart - leadIn);

    log("cutting and normalising");
    await mkdir(AUDIO_DIR, { recursive: true });
    const output = path.join(AUDIO_DIR, `${outputId}.mp3`);

    await run(
      "ffmpeg",
      [
        "-y",
        "-hide_banner",
        "-loglevel", "error",
        "-ss", String(cutStart),
        "-t", String(CLIP_LENGTH),
        "-i", source,
        "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
        "-ac", "2",
        "-ar", "44100",
        "-b:a", "160k",
        "-map_metadata", "-1",
        output,
      ],
      { maxBuffer: 1024 * 1024 * 16 },
    );

    const { stdout } = await run("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      output,
    ]);

    return {
      audio: `/audio/${outputId}.mp3`,
      soloStart: resolvedStart,
      leadIn,
      clipDuration: Number(Number(stdout.trim()).toFixed(3)),
      markerLevel: await levelAtMarker(output, leadIn),
    };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/**
 * Mean volume of the two seconds the game will actually play, in dBFS.
 *
 * A timestamp can be wrong in two ways: it can point at the wrong music, which
 * only a person can hear, or it can point at nothing at all — an upload that
 * opens with a few seconds of silence, a time past the fade-out. The second
 * kind is the one worth catching automatically, because a hundred-millisecond
 * snippet of silence is indistinguishable from a broken game.
 */
export async function levelAtMarker(file, marker) {
  try {
    const { stderr } = await run(
      "ffmpeg",
      [
        "-hide_banner", "-nostats",
        "-ss", String(marker),
        "-t", "2",
        "-i", file,
        "-af", "volumedetect",
        "-f", "null", "-",
      ],
      { maxBuffer: 1024 * 1024 * 4 },
    );
    const match = /mean_volume:\s*(-?[\d.]+)/.exec(stderr ?? "");
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

/** Below this the clip is effectively silent where the round would start. */
export const SILENT_DBFS = -45;

/**
 * Where the music actually begins.
 *
 * "The start of the track" is not reliably second zero: uploads open with
 * dead air, needle drop, or a few frames of encoder padding. Cutting from a
 * detected onset rather than from 0 is the difference between a snippet of
 * music and a snippet of nothing.
 */
export async function detectAudibleStart(file) {
  try {
    const { stderr } = await run(
      "ffmpeg",
      [
        "-hide_banner", "-nostats",
        "-t", "90",
        "-i", file,
        "-af", `silencedetect=noise=${SILENT_DBFS}dB:d=0.2`,
        "-f", "null", "-",
      ],
      { maxBuffer: 1024 * 1024 * 8 },
    );

    const opensSilent = /silence_start:\s*(-?[\d.]+)/.exec(stderr ?? "");
    if (!opensSilent || Number(opensSilent[1]) > 0.05) return 0;

    const ends = /silence_end:\s*([\d.]+)/.exec(stderr ?? "");
    if (!ends) return 0;

    // Back off a hair so the first attack is not shaved off.
    return Math.max(0, Number(Number(ends[1]) - 0.05).toFixed(3));
  } catch {
    return 0;
  }
}

/* ------------------------------------------------------------------
   Library file
   ------------------------------------------------------------------ */

export async function readLibrary() {
  if (!existsSync(LIBRARY_PATH)) return { version: 1, solos: [] };
  const raw = await readFile(LIBRARY_PATH, "utf8");
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`data/solos.json is not valid JSON`);
  }
}

export async function writeLibrary(library) {
  await mkdir(path.dirname(LIBRARY_PATH), { recursive: true });
  await writeFile(LIBRARY_PATH, `${JSON.stringify(library, null, 2)}\n`, "utf8");
}

/** Catalogue numbers run HZ-1501 upward, in the order clips were added. */
export function nextCatalog(library) {
  const used = library.solos
    .map((s) => Number(String(s.catalog).replace(/\D/g, "")))
    .filter(Number.isFinite);
  const next = used.length ? Math.max(...used) + 1 : 1501;
  return `HZ-${next}`;
}

export async function upsertSolo(solo) {
  const library = await readLibrary();
  const idx = library.solos.findIndex((s) => s.id === solo.id);
  if (idx >= 0) library.solos[idx] = { ...library.solos[idx], ...solo };
  else library.solos.push(solo);
  await writeLibrary(library);
  return solo;
}
