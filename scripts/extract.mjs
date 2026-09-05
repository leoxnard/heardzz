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
import { mkdtemp, rm, mkdir, readFile, readdir, stat, writeFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const run = promisify(execFile);

export const PRE_ROLL = 2;
export const POST_ROLL = 20;
export const CLIP_LENGTH = PRE_ROLL + POST_ROLL;

/**
 * Everything written at runtime lives under one directory, outside the build,
 * so a server can mount it as a volume and keep it across deploys.
 */
export const DATA_DIR = process.env.HEARDZZ_DATA_DIR
  ? path.resolve(process.env.HEARDZZ_DATA_DIR)
  : path.join(process.cwd(), "data");

export const AUDIO_DIR = path.join(DATA_DIR, "audio");

/**
 * Whole recordings, held only while somebody is marking them up.
 *
 * Marking a solo means looking at the tune end to end, so the source is
 * fetched once, kept on disk for the length of the session, and thrown away
 * the moment the clips have been cut from it. Nothing here is permanent:
 * anything left behind is an abandoned session, not data.
 */
export const SOURCE_DIR = path.join(DATA_DIR, "sources");
export const LIBRARY_PATH = path.join(DATA_DIR, "solos.json");
export const SUGGESTIONS_PATH = path.join(DATA_DIR, "suggestions.json");

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
 * The part of a failed yt-dlp call worth a person's time.
 *
 * `run()` rejects with the whole invocation in `error.message` — the binary,
 * every flag, the full stderr — because that is right for a script's own
 * failure output. It is wrong for a playlist import, where the message lands
 * verbatim next to a record's title and a hundred-character command line
 * says nothing a status word does not say better. The common cases are named
 * outright; anything else falls back to yt-dlp's own ERROR line, stripped of
 * the "[youtube] <id>:" prefix it always carries.
 */
function friendlyYtdlpFailure(target, error) {
  const stderr = String(error?.stderr || error?.message || "");
  if (/private video/i.test(stderr)) return "That video is private.";
  if (/video unavailable/i.test(stderr)) return "That video is no longer available.";
  if (/removed by the (?:uploader|user)/i.test(stderr)) return "That video was taken down by whoever uploaded it.";
  if (/copyright/i.test(stderr)) return "That video was taken down over a copyright claim.";
  if (/not available in your country|blocked it in your country/i.test(stderr)) {
    return "That video is blocked in this region.";
  }
  if (/sign in to confirm your age|age.restrict/i.test(stderr)) return "That video is age-restricted.";

  const line = stderr.split("\n").find((entry) => /^error:/i.test(entry.trim()));
  const reason = line
    ?.replace(/^error:\s*/i, "")
    .replace(/^\[[^\]]+\]\s*[\w-]{6,}:\s*/i, "")
    .trim();
  return reason || `Could not read "${target}"`;
}

/**
 * Resolve a search phrase or URL to a single video without downloading.
 * Doing this first means a bad match is caught before any bytes move.
 */
export async function resolveSource(target) {
  const query = /^https?:\/\//.test(target) ? target : `ytsearch1:${target}`;

  let stdout;
  try {
    ({ stdout } = await run(
      "yt-dlp",
      [
        "--no-playlist",
        "--skip-download",
        "--no-warnings",
        "--print",
        "%(id)s\t%(title)s\t%(duration)s\t%(uploader)s\t%(artist)s\t%(track)s\t%(album)s\t%(release_year)s",
        query,
      ],
      { maxBuffer: 1024 * 1024 * 8 },
    ));
  } catch (error) {
    throw new Error(friendlyYtdlpFailure(target, error));
  }

  const [id, title, duration, uploader, artist, track, album, year] = stdout
    .trim()
    .split("\n")[0]
    .split("\t");

  if (!id) throw new Error(`No video found for "${target}"`);

  // yt-dlp prints "NA" for fields the upload does not carry.
  const real = (value) => (value && value !== "NA" ? value : "");

  return {
    youtubeId: id,
    title,
    duration: Number(duration) || 0,
    uploader,
    // Present on YouTube Music and auto-generated "Topic" uploads, absent on
    // most hand-uploaded videos. Worth taking when it is there.
    artist: real(artist),
    track: real(track),
    album: real(album),
    year: Number(real(year)) || 0,
  };
}

/**
 * Several search hits for one phrase, without downloading any of them.
 *
 * `resolveSource` takes the first result and trusts it, which is right when
 * a person typed the phrase and will see what came back. Nothing is watching
 * when a record arrives from TIDAL, so the caller needs a field to choose
 * from and something to check each one against — the duration and the
 * uploader are what it checks. Scoring lives in lib/tidal-youtube.ts; this
 * only fetches.
 */
export async function searchCandidates(phrase, limit = 5) {
  const { stdout } = await run(
    "yt-dlp",
    [
      "--no-playlist",
      "--skip-download",
      "--no-warnings",
      "--print",
      "%(id)s\t%(title)s\t%(duration)s\t%(uploader)s\t%(artist)s\t%(track)s\t%(album)s\t%(release_year)s",
      `ytsearch${Math.max(1, Math.min(10, limit))}:${phrase}`,
    ],
    { maxBuffer: 1024 * 1024 * 16 },
  );

  const real = (value) => (value && value !== "NA" ? value : "");

  return stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [id, title, duration, uploader, artist, track, album, year] = line.split("\t");
      return {
        youtubeId: id,
        title: title || "",
        duration: Number(duration) || 0,
        uploader: real(uploader),
        artist: real(artist),
        track: real(track),
        album: real(album),
        year: Number(real(year)) || 0,
      };
    })
    .filter((entry) => /^[A-Za-z0-9_-]{11}$/.test(entry.youtubeId));
}

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

/* ------------------------------------------------------------------
   Whole recordings, while they are being marked up.

   The old pipeline downloaded a recording, cut one window out of it and threw
   the rest away — so finding a second solo meant downloading the same eight
   minutes again. Now the recording is fetched once and kept: everything is
   marked against the whole tune, the clips are cut at the end, and the source
   is dropped in the same breath.

   Two files per source. The wav is what the clips are cut from, because
   cutting from a re-encode and then encoding again is two generations of loss
   for no reason. The mp3 is the one the browser downloads to draw and play.
   ------------------------------------------------------------------ */

const sourceMaster = (youtubeId) => path.join(SOURCE_DIR, `${youtubeId}.wav`);
const sourcePreview = (youtubeId) => path.join(SOURCE_DIR, `${youtubeId}.mp3`);

export function sourcePreviewUrl(youtubeId) {
  return `/api/audio/source/${youtubeId}.mp3`;
}

async function probeDuration(file) {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  return Number(Number(stdout.trim()).toFixed(3)) || 0;
}

/** Is this recording already on disk, ready to be marked up? */
export function sourceIsReady(youtubeId) {
  return existsSync(sourceMaster(youtubeId)) && existsSync(sourcePreview(youtubeId));
}

/**
 * Put a whole recording on disk and return what the marking screen needs:
 * something to play, how long it runs, and where the music starts.
 *
 * Idempotent — asking twice for the same recording costs one ffprobe.
 */
export async function fetchSource({ youtubeId, onProgress }) {
  const log = onProgress ?? (() => {});
  await mkdir(SOURCE_DIR, { recursive: true });

  const master = sourceMaster(youtubeId);
  const preview = sourcePreview(youtubeId);

  if (!existsSync(master)) {
    const work = await mkdtemp(path.join(tmpdir(), "heardzz-"));
    try {
      log("downloading the recording");
      await download(youtubeId, work);
      const fetched = path.join(work, "source.wav");
      if (!existsSync(fetched)) {
        throw new Error("yt-dlp finished but produced no audio file");
      }
      // Across a mount rename fails, so copy and drop the temp copy.
      await copyFile(fetched, master);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }

  if (!existsSync(preview)) {
    log("preparing the preview");
    // Mono at 96k: the browser only has to draw it and play it back, and a
    // stereo master doubles the download for a waveform that looks the same.
    await run("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error",
      "-i", master,
      "-ac", "1",
      "-ar", "44100",
      "-b:a", "96k",
      "-map_metadata", "-1",
      preview,
    ], { maxBuffer: 1024 * 1024 * 16 });
  }

  return {
    youtubeId,
    previewUrl: sourcePreviewUrl(youtubeId),
    duration: await probeDuration(master),
    // Precomputed so the marking screen opens with the downbeat already
    // marked and the only positions left to place are the solos.
    audibleStart: await detectAudibleStart(master),
  };
}

/** Throw a recording away. Called once its clips exist. */
export async function dropSource(youtubeId) {
  await Promise.all([
    rm(sourceMaster(youtubeId), { force: true }),
    rm(sourcePreview(youtubeId), { force: true }),
  ]);
}

/** Every recording currently held, oldest first. Abandoned sessions, mostly. */
export async function listSources() {
  if (!existsSync(SOURCE_DIR)) return [];
  const names = await readdir(SOURCE_DIR);
  const out = [];
  for (const name of names) {
    if (!name.endsWith(".wav")) continue;
    const youtubeId = name.slice(0, -4);
    const info = await stat(path.join(SOURCE_DIR, name)).catch(() => null);
    if (info) out.push({ youtubeId, bytes: info.size, fetchedAt: info.mtimeMs });
  }
  return out.sort((a, b) => a.fetchedAt - b.fetchedAt);
}

/**
 * Cut one clip out of a recording already on disk. No network.
 *
 * `start` is the instant the round should open on; the file carries `PRE_ROLL`
 * seconds ahead of it so the entry point can still be nudged afterwards
 * without going back to the source.
 */
export async function cutFromSource({ youtubeId, start, outputId, onProgress }) {
  const log = onProgress ?? (() => {});
  const master = sourceMaster(youtubeId);
  if (!existsSync(master)) {
    await fetchSource({ youtubeId, onProgress });
  }

  const resolvedStart = start === "opening"
    ? await detectAudibleStart(master)
    : start === "first-sound"
      ? await detectFirstSound(master)
      : Number(start);
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
      "-i", master,
      "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
      "-ac", "2",
      "-ar", "44100",
      "-b:a", "160k",
      "-map_metadata", "-1",
      output,
    ],
    { maxBuffer: 1024 * 1024 * 16 },
  );

  return {
    audio: `/api/audio/${outputId}.mp3`,
    soloStart: Number(resolvedStart.toFixed(3)),
    leadIn: Number(leadIn.toFixed(3)),
    clipDuration: await probeDuration(output),
    sourceDuration: await probeDuration(master),
    markerLevel: await levelAtMarker(output, leadIn),
  };
}

/**
 * Fetch, cut, and drop the source again — the one-shot path the older import
 * and re-cut routes still take. Pass `keepSource` when more clips are coming
 * out of the same recording.
 */
export async function extractClip({ youtubeId, soloStart, outputId, onProgress, keepSource }) {
  await fetchSource({ youtubeId, onProgress });
  try {
    return await cutFromSource({ youtubeId, start: soloStart, outputId, onProgress });
  } finally {
    if (!keepSource) await dropSource(youtubeId);
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
export async function levelAtMarker(file, marker, seconds = 2) {
  try {
    const { stderr } = await run(
      "ffmpeg",
      [
        "-hide_banner", "-nostats",
        "-ss", String(marker),
        "-t", String(seconds),
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

/** Loudest sample in a file, in dBFS, or null when ffmpeg cannot say. */
async function peakLevel(file) {
  try {
    const { stderr } = await run(
      "ffmpeg",
      ["-hide_banner", "-nostats", "-i", file, "-af", "volumedetect", "-f", "null", "-"],
      { maxBuffer: 1024 * 1024 * 8 },
    );
    const match = /max_volume:\s*(-?[\d.]+)/.exec(stderr ?? "");
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

/**
 * A level envelope of the opening: one RMS reading every tenth of a second.
 *
 * ffmpeg's `astats` is reset every frame and the readings printed to a file,
 * which gives the shape of the opening without decoding anything twice.
 * Returns [] when ffmpeg cannot be read, and the caller falls back.
 */
async function levelEnvelope(file, seconds = 120) {
  const work = await mkdtemp(path.join(tmpdir(), "heardzz-env-"));
  const report = path.join(work, "levels.txt");
  try {
    await run(
      "ffmpeg",
      [
        "-hide_banner", "-nostats", "-loglevel", "error",
        "-t", String(seconds),
        "-i", file,
        "-af", [
          // Mono at 8k: this is measuring loudness over tenths of a second,
          // and a stereo 44.1k decode measures the same thing far slower.
          "aresample=8000",
          "aformat=channel_layouts=mono",
          `asetnsamples=n=${FRAME_SAMPLES}`,
          "astats=metadata=1:reset=1",
          `ametadata=print:key=lavfi.astats.Overall.RMS_level:file=${report}`,
        ].join(","),
        "-f", "null", "-",
      ],
      { maxBuffer: 1024 * 1024 * 8 },
    );

    const text = await readFile(report, "utf8");
    const frames = [];
    let at = null;
    for (const line of text.split("\n")) {
      const time = /^frame:\d+\s+pts:\S+\s+pts_time:([\d.]+)/.exec(line);
      if (time) {
        at = Number(time[1]);
        continue;
      }
      const level = /RMS_level=(-?[\d.]+|-?inf)/.exec(line);
      if (level && at !== null) {
        frames.push({ at, db: level[1].includes("inf") ? -120 : Number(level[1]) });
        at = null;
      }
    }
    return frames;
  } catch {
    return [];
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** 800 samples at 8 kHz — a tenth of a second per reading. */
const FRAME_SAMPLES = 800;
const FRAME_SECONDS = FRAME_SAMPLES / 8000;

/** How long sound has to hold up to count as the music rather than a noise. */
const SUSTAIN_SECONDS = 0.9;

function percentile(sorted, fraction) {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * fraction)));
  return sorted[index];
}

/**
 * Where the music actually begins.
 *
 * "The start of the track" is not reliably second zero: uploads open with
 * dead air, needle drop, a cough, a few frames of encoder padding, or the
 * crackle of a transfer running before the stylus reaches the groove.
 *
 * Silence detection alone cannot tell the last of those from the downbeat —
 * a click is not silence, so the silence ends at the click and the round
 * opens on a pop with the tune still a second away. So the opening is
 * measured as a level envelope instead, and the start is the first moment
 * loud enough to be music *and* still loud a second later. A crackle fails
 * the second half of that; a horn does not.
 *
 * The threshold is measured against the recording's own levels rather than
 * against a fixed dBFS floor. A 1928 transfer sits far below a modern
 * master, and a fixed floor reads its opening chorus as silence — which is
 * exactly how an earlier version of this put the start of West End Blues
 * twelve seconds into the cornet solo, and did it differently on each
 * download.
 */
export async function detectAudibleStart(file) {
  const frames = await levelEnvelope(file);
  if (frames.length >= 20) {
    const found = onsetFromEnvelope(frames);
    if (found !== null) return found;
  }
  return detectAudibleStartBySilence(file);
}

function onsetFromEnvelope(frames) {
  const sorted = frames.map((frame) => frame.db).sort((a, b) => a - b);
  const floor = percentile(sorted, 0.1);
  const loud = percentile(sorted, 0.9);
  if (floor === null || loud === null) return null;

  // Nothing to find: the recording is at one level the whole way through,
  // which means it is playing from the first frame.
  if (loud - floor < 6) return 0;

  /*
   * Twelve decibels over the background is comfortably above tape hiss,
   * surface noise and room tone, and comfortably below anything anybody is
   * playing. The clamps stop that from landing above the music itself on a
   * noisy transfer, or so far under it on a digitally silent lead-in that
   * the hiss counts as the band.
   */
  const threshold = Math.min(Math.max(floor + 12, loud - 40), loud - 6);

  const sustain = Math.max(2, Math.round(SUSTAIN_SECONDS / FRAME_SECONDS));
  // A held note dips below its own average; ask for most of the window, not
  // all of it, or a marker lands one bar into the tune instead of on it.
  const needed = Math.ceil(sustain * 0.7);

  for (let i = 0; i < frames.length; i++) {
    if (frames[i].db < threshold) continue;
    const window = frames.slice(i, i + sustain);
    if (window.length < Math.min(sustain, frames.length - i)) break;
    const above = window.filter((frame) => frame.db >= threshold).length;
    if (above < Math.min(needed, window.length)) continue;

    // Back off a hair so the first attack is not shaved off — the frame is
    // a tenth of a second wide and the attack is somewhere inside it.
    const at = Math.max(0, frames[i].at - FRAME_SECONDS);
    // Too far in to be the opening of anything: let the caller fall back.
    if (at > LATEST_OPENING) return null;
    return Number(at.toFixed(3));
  }

  return null;
}

/**
 * The older reading, kept as the fallback: find the silence the upload opens
 * with and take the moment it ends. Cheaper, and right whenever the lead-in
 * really is silent.
 */
/**
 * Where the first sound is, rather than where the music gets going.
 *
 * `detectAudibleStart` asks for a level that is sustained near the loudest
 * part of the recording, which is right for a jazz side: room tone, then a
 * band. It is wrong for anything compressed. On a modern pop master the
 * quiet 10th percentile is already loud, so the `loud - 6` clamp binds and
 * the marker skips the intro to land on the drop — twenty seconds in, on a
 * round that is supposed to open on the top of the tune.
 *
 * This one only asks whether the file opens with silence, and if so where
 * that silence ends. A record that starts playing immediately gets zero,
 * which is the honest answer for most things that are not a 1959 session.
 */
export async function detectFirstSound(file) {
  const frames = await levelEnvelope(file);
  if (frames.length >= 20) {
    const found = onsetFromFadeIn(frames);
    if (found !== null) return found;
  }
  return detectAudibleStartBySilence(file);
}

/**
 * How far under the loud part of a record still counts as the record.
 *
 * The two detectors either side of this one both got it wrong, in opposite
 * directions. `detectAudibleStart` asks for within 6 dB of the loud level,
 * which on a compressed master means the drop — twenty seconds in.
 * Silence detection asks only for something above the noise floor, which on
 * a fade-in means the very bottom of the fade: an Insomnia round opened at
 * -60 dB and took three seconds to reach anything a person could hear,
 * which is most of a round spent listening to nothing.
 *
 * Eighteen decibels is the room between them. Quiet playing clears it; a
 * fade still climbing towards the tune does not.
 */
const FADE_IN_RANGE = 24;

/**
 * How far into a record this is willing to open at all.
 *
 * A relative threshold can still be defeated — a record whose opening is
 * genuinely far quieter than the rest of it will not clear any sensible
 * bar until the tune proper arrives, and an earlier attempt at this opened
 * Insomnia thirty-five seconds in. Past this point the answer is not "the
 * music starts here", it is "this detector has failed", and trimming the
 * digital silence off the front is the more honest of the two.
 */
const LATEST_OPENING = 8;

/**
 * Where a record becomes audible, as opposed to where it becomes loud.
 *
 * Half a second of sustain rather than the nine tenths `onsetFromEnvelope`
 * asks for: this is looking for the point a fade has arrived at, not for an
 * entry that has to be held, and a longer window only pushes the marker
 * further into a tune that already started.
 */
function onsetFromFadeIn(frames) {
  const sorted = frames.map((frame) => frame.db).sort((a, b) => a - b);
  const floor = percentile(sorted, 0.1);
  const loud = percentile(sorted, 0.9);
  if (floor === null || loud === null) return null;

  // One level throughout means it is playing from the first frame.
  if (loud - floor < 6) return 0;

  /*
   * Relative to the loud part only. Anchoring to the noise floor as well
   * reads as prudent and does nothing here: a compressed master has a
   * floor within a few decibels of its peak, so `floor + anything` lands
   * above the whole record and never matches at all.
   */
  const threshold = loud - FADE_IN_RANGE;

  const sustain = Math.max(2, Math.round(0.5 / FRAME_SECONDS));
  const needed = Math.ceil(sustain * 0.7);

  for (let i = 0; i < frames.length; i++) {
    if (frames[i].db < threshold) continue;
    const window = frames.slice(i, i + sustain);
    const above = window.filter((frame) => frame.db >= threshold).length;
    if (above < Math.min(needed, window.length)) continue;

    return Number(Math.max(0, frames[i].at - FRAME_SECONDS).toFixed(3));
  }

  return null;
}

async function detectAudibleStartBySilence(file) {
  try {
    const peak = await peakLevel(file);
    // 35 dB below the loudest moment is comfortably above tape hiss and
    // comfortably below anything anybody is playing.
    const threshold = peak === null
      ? SILENT_DBFS
      : Math.min(-25, Math.max(-60, peak - 35));

    const { stderr } = await run(
      "ffmpeg",
      [
        "-hide_banner", "-nostats",
        "-t", "90",
        "-i", file,
        "-af", `silencedetect=noise=${threshold.toFixed(1)}dB:d=0.3`,
        "-f", "null", "-",
      ],
      { maxBuffer: 1024 * 1024 * 8 },
    );

    const opensSilent = /silence_start:\s*(-?[\d.]+)/.exec(stderr ?? "");
    if (!opensSilent || Number(opensSilent[1]) > 0.05) return 0;

    const ends = /silence_end:\s*([\d.]+)/.exec(stderr ?? "");
    if (!ends) return 0;

    return Number(Math.max(0, Number(ends[1]) - 0.05).toFixed(3));
  } catch {
    return 0;
  }
}

/**
 * Does this point look like the start of something?
 *
 * Sound at the marker, and markedly less of it just before. A marker dropped
 * into the middle of a solo passes the first test and fails this one.
 */
export async function looksLikeAnOnset(file, marker) {
  const after = await levelAtMarker(file, marker);
  if (after === null || after < SILENT_DBFS) return false;

  // The comparison window has to end at the marker, not straddle it, or it
  // measures the very music it is supposed to be the run-up to. With less
  // than half a second of run-up there is nothing to compare against and the
  // question does not arise.
  const runUp = Math.min(1.5, marker);
  if (runUp < 0.5) return true;

  const before = await levelAtMarker(file, marker - runUp, runUp);
  if (before === null) return true;
  return before < after - 8;
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

/**
 * What each solo names as its clip and, when the file is missing, what it
 * takes to cut it again.
 *
 * The name on a solo's `audio` field is the source of truth for where its
 * clip lives — not the solo's own id, which only matches for the entry that
 * opened the record. A record with three soloists shares one head clip
 * across three different ids, so deriving the target from the id would ask
 * for a file that was never written and, worse, would cut three duplicates
 * of the same clip if asked to repair it. Collapsing on the audio path
 * instead means a shared clip is one thing to check and one thing to fetch,
 * however many entries point at it.
 */
export function audioTargets(solos) {
  const targets = new Map();
  const add = (audioUrl, youtubeId, start) => {
    if (!audioUrl) return;
    const outputId = path.basename(audioUrl).replace(/\.mp3$/, "");
    if (!targets.has(outputId)) targets.set(outputId, { outputId, youtubeId, start });
  };
  for (const solo of solos) {
    add(solo.audio, solo.youtubeId, solo.soloStart);
    if (solo.soloClip) add(solo.soloClip.audio, solo.youtubeId, solo.soloClip.start);
  }
  return [...targets.values()];
}

/** Audio targets whose file is not actually on disk. */
export function missingAudioTargets(solos) {
  return audioTargets(solos).filter(
    (target) => !existsSync(path.join(AUDIO_DIR, `${target.outputId}.mp3`)),
  );
}

/**
 * Write a freshly cut clip's numbers onto every solo that names it.
 *
 * One extraction can settle more than one entry — the shared head clip on a
 * multi-solo record — so this updates the library in one pass rather than
 * one upsert per solo.
 */
export async function applyClipToLibrary(outputId, clip) {
  const library = await readLibrary();
  let touched = 0;

  for (const solo of library.solos) {
    if (solo.audio && path.basename(solo.audio).replace(/\.mp3$/, "") === outputId) {
      solo.audio = clip.audio;
      solo.leadIn = clip.leadIn;
      solo.clipDuration = clip.clipDuration;
      solo.sourceDuration = clip.sourceDuration;
      /*
       * The stems were separated from the audio this just replaced, and they
       * keep the same filenames — so nothing downstream would notice that
       * they now belong to a different piece of music. They have to go, and
       * `npm run split-stems` makes them again.
       */
      delete solo.stems;
      touched += 1;
    }
    if (
      solo.soloClip &&
      path.basename(solo.soloClip.audio).replace(/\.mp3$/, "") === outputId
    ) {
      // Spreading the old cut would carry its stems across; see above.
      solo.soloClip = {
        ...solo.soloClip,
        audio: clip.audio,
        leadIn: clip.leadIn,
        clipDuration: clip.clipDuration,
        stems: undefined,
      };
      touched += 1;
    }
  }

  if (touched > 0) await writeLibrary(library);
  return touched;
}

export async function upsertSolo(solo) {
  const library = await readLibrary();
  const idx = library.solos.findIndex((s) => s.id === solo.id);
  if (idx >= 0) library.solos[idx] = { ...library.solos[idx], ...solo };
  else library.solos.push(solo);
  await writeLibrary(library);
  return solo;
}

/**
 * List a playlist without downloading anything.
 *
 * `--flat-playlist` asks YouTube for the index page only, so one request
 * covers the whole list instead of one per track. It carries less than a
 * full resolve — no artist/track tags — which is why the caller still has
 * to read the title. The cap is there because the list is unbounded and
 * everything downstream of this costs a Discogs call.
 */
export async function resolvePlaylist(target, limit = 25) {
  const { stdout } = await run(
    "yt-dlp",
    [
      "--flat-playlist",
      "--skip-download",
      "--no-warnings",
      "--playlist-end", String(limit),
      "--print", "%(id)s\t%(title)s\t%(duration)s\t%(uploader)s",
      target,
    ],
    { maxBuffer: 1024 * 1024 * 16 },
  );

  const entries = stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [id, title, duration, uploader] = line.split("\t");
      return {
        youtubeId: id,
        title: title || "",
        duration: Number(duration) || 0,
        uploader: uploader && uploader !== "NA" ? uploader : "",
      };
    })
    // Deleted and private entries stay in the index with an id but nothing
    // playable behind them.
    .filter((entry) => /^[A-Za-z0-9_-]{11}$/.test(entry.youtubeId)
      && !/^\[(Private|Deleted) video\]$/i.test(entry.title));

  if (!entries.length) throw new Error(`No videos found in "${target}"`);
  return entries;
}
