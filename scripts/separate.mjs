/* ------------------------------------------------------------------
   Pulling a recording apart.

   A clip is a mix. This takes one and produces three more: the melody on its
   own, the accompaniment — everything the record has except the melody —
   and the bass. On a Blue Note quintet those are the horn, the band behind
   it, and the walk: three quite different games. One asks you to name a
   player by their sound alone, one to name a record with its most obvious
   clue removed, and one to do it on four notes a bar.

   The pair is a subtraction and the two halves are exactly complementary.
   Which heads the melody is made of depends on who is playing it — the
   soloist on a solo cut, whoever states the theme on the opening — so it is
   not fixed: see `leadStemFor` and `melodyHeadsFor` below. Whatever is left
   is the accompaniment, horns included when the piano has the tune.

   Nothing here runs while anybody is playing. These are files, cut once and
   served like any other clip, and the game only ever picks a different URL.

   The model is Demucs (https://github.com/adefossez/demucs), the same family
   behind Logic's Stem Splitter. `htdemucs_6s` rather than the four-stem
   default, and that choice is load-bearing rather than cosmetic: with four
   stems `other` on a piano trio *is* the comping piano, so it is not silent,
   so the emptiness check below passes it and the game deals a round with no
   lead voice in it. The six-stem model splits piano and guitar out, which
   leaves `other` meaning roughly "the horns" — and on a trio, meaning
   nothing at all, loudly enough to be detected.
   ------------------------------------------------------------------ */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp, rm, mkdir, readdir, writeFile, readFile, rename, copyFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { AUDIO_DIR, DATA_DIR, SILENT_DBFS, levelAtMarker } from "./extract.mjs";

const run = promisify(execFile);

/* ------------------------------------------------------------------
   The separator itself.

   Torch and the model weights are ~1.1 GB, and baking them into the image
   would make every deploy carry them whether or not a record is ever added.
   So they go where the clips go: the data volume, which survives deploys.
   The image carries only python3 and python3-venv, which are ~7 MB and
   which the venv cannot be created without — node:24-slim has neither, and
   `python3 -m venv` without `python3-venv` fails on a missing `ensurepip`.
   ------------------------------------------------------------------ */

const TOOLS_DIR = path.join(DATA_DIR, "tools");
const VENV_DIR = path.join(TOOLS_DIR, "demucs");
const VENV_BIN = path.join(VENV_DIR, "bin");
const DEMUCS = path.join(VENV_BIN, "demucs");
const READY_MARKER = path.join(VENV_DIR, ".ready");

/**
 * Where the weights are cached.
 *
 * Demucs 4 resolves a named bag of models through the HuggingFace hub, which
 * reads HF_HOME; TORCH_HOME only covers the older direct-download fallback.
 * Setting one and not the other means the weights are fetched again on every
 * deploy, so both point at the volume.
 */
const MODEL_ENV = {
  HF_HOME: path.join(TOOLS_DIR, "models"),
  TORCH_HOME: path.join(TOOLS_DIR, "models"),
};

/** Bumped when the install recipe changes and the venv has to be rebuilt. */
const RECIPE = "demucs-4 torch-cpu numpy v2";

export const MODEL = "htdemucs_6s";

/**
 * The fallback models for the bass, tried in order and only when needed.
 *
 * The six-stem model earns its place by splitting piano and guitar out of
 * `other`, which is what makes the lead voice legible. It pays for that at
 * the low end: with a guitar head to feed, a plucked upright is routinely
 * routed away from `bass` and turns up under `guitar`.
 *
 * Measured over the library, on the twenty cuts where six stems and
 * `htdemucs` both came back empty, `mdx_extra` finds a real bass on nine and
 * `hdemucs_mmi` on four — so `mdx_extra` leads, and `htdemucs` stays behind
 * it because it is the one that rescued four cuts in the first place.
 * Spectrally checked rather than taken on level alone: `mdx_extra`'s bass
 * falls ~32 dB above 1 kHz, which is an upright and not a muffled mix.
 *
 * Not run unconditionally. Each one is another pass over the audio, and on
 * most records the first model already has the bass.
 */
const BASS_FALLBACK_MODELS = ["mdx_extra", "htdemucs"];

/**
 * Build the separator if it is not already there. Idempotent and slow once.
 *
 * The first call downloads a little over a gigabyte. Every call after it
 * reads one small file and returns.
 */
export async function ensureSeparator({ onProgress } = {}) {
  const log = onProgress ?? (() => {});

  if (existsSync(READY_MARKER)) {
    const stamped = await readFile(READY_MARKER, "utf8").catch(() => "");
    if (stamped.trim() === RECIPE) return DEMUCS;
  }

  await mkdir(TOOLS_DIR, { recursive: true });

  if (!existsSync(path.join(VENV_BIN, "python"))) {
    log("creating the python environment");
    try {
      await run("python3", ["-m", "venv", VENV_DIR]);
    } catch (error) {
      throw new Error(
        "Could not create a python environment. On Debian this needs the " +
          `python3-venv package as well as python3. (${error.message.split("\n")[0]})`,
      );
    }
  }

  const pip = path.join(VENV_BIN, "pip");

  /*
   * The pip that ensurepip bootstraps is whatever Debian froze, and it is old
   * enough to want to build some of torch's dependencies from source rather
   * than take a wheel. That matters below, where the index it can reach is
   * restricted — a source build needs flit_core, flit_core is not on the
   * torch index, and the whole install dies on a package nobody asked for.
   */
  log("updating pip");
  await run(pip, ["install", "-q", "-U", "pip"], { maxBuffer: 1024 * 1024 * 16 });

  /*
   * Torch first and on its own. PyPI's default linux wheel is the CUDA build
   * at 554 MB; the CPU build is 184 MB and lives on a separate index.
   *
   * `--index-url` REPLACES the default index rather than adding to it, so on
   * its own it also hides every ordinary dependency — hence the extra index
   * alongside it. Having both is safe here: PEP 440 sorts a local version
   * above the plain one, so `2.14.0+cpu` from the torch index beats `2.14.0`
   * from PyPI, and the CPU build wins without being asked to.
   *
   * That ordering is an argument, not a guarantee — a newer base version on
   * PyPI would outrank an older CPU build — so the result is checked below
   * rather than assumed.
   */
  log("installing torch (this is the slow part)");
  const onLinux = process.platform === "linux";
  const indexes = onLinux
    ? [
        "--index-url", "https://download.pytorch.org/whl/cpu",
        "--extra-index-url", "https://pypi.org/simple",
      ]
    : [];
  await run(pip, ["install", "-q", "-U", "torch", ...indexes], { maxBuffer: 1024 * 1024 * 16 });

  if (onLinux) {
    const { stdout } = await run(
      path.join(VENV_BIN, "python"),
      ["-c", "import torch; print(torch.__version__)"],
      { maxBuffer: 1024 * 1024 },
    );
    const version = stdout.trim();
    if (!version.includes("+cpu")) {
      throw new Error(
        `Installed torch ${version} rather than a CPU build. That is the CUDA ` +
          "wheel, several hundred megabytes of it, on a machine with no GPU. " +
          `Remove ${VENV_DIR} and retry; if it recurs the CPU index has fallen ` +
          "behind PyPI and the version needs pinning.",
      );
    }
    log(`torch ${version}`);
  }

  /*
   * numpy is named explicitly because torch 2.14 no longer pulls it in, and
   * demucs dies on the import rather than at install time — which surfaces as
   * a separation that fails on the first record and not on the setup step.
   */
  log("installing demucs");
  await run(pip, ["install", "-q", "-U", "demucs", "numpy"], { maxBuffer: 1024 * 1024 * 16 });

  await writeFile(READY_MARKER, `${RECIPE}\n`);
  log("separator ready");
  return DEMUCS;
}

/** Is the separator already built? Lets a caller skip a slow path knowingly. */
export function separatorIsReady() {
  return existsSync(DEMUCS) && existsSync(READY_MARKER);
}

/* ------------------------------------------------------------------
   Measuring a stem.
   ------------------------------------------------------------------ */

/** Loudest sample in a window, in dBFS, or null when ffmpeg cannot say. */
async function peakInWindow(file, at, seconds) {
  try {
    const { stderr } = await run(
      "ffmpeg",
      [
        "-hide_banner", "-nostats",
        "-ss", String(at),
        "-t", String(seconds),
        "-i", file,
        "-af", "volumedetect",
        "-f", "null", "-",
      ],
      { maxBuffer: 1024 * 1024 * 4 },
    );
    const match = /max_volume:\s*(-?[\d.]+)/.exec(stderr ?? "");
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

/**
 * How far under the full mix a stem has to sit before it counts as empty.
 *
 * The failure this catches is structural, not quiet: a piano trio has no
 * horn, so `other` comes back as separation residue rather than as a part.
 * Measured across the library that reads as 60-plus dB under the mix, while
 * a real horn sits within a few dB of it — so the ratio separates the two
 * cases with room to spare, and an absolute threshold would not. A hushed
 * ballad entry can be genuinely quiet and still be the lead voice; residue
 * can be louder than that and still be nothing.
 */
const EMPTY_BELOW_MIX = -25;

/**
 * And how quiet the opening half-second may be.
 *
 * The ladder opens at 0.5 s. A stem that is silent for the first two seconds
 * and arrives afterwards is useless for the rung the round actually starts
 * on, and a two-second mean is too forgiving to notice — so the opening is
 * measured on its own, on the peak rather than the mean, because one note
 * inside the window is enough to make a puzzle.
 *
 * Two thresholds, because there are two ways to be silent at the top. The
 * absolute one catches a clip that opens in room tone, where a ratio would
 * be comparing nothing to nothing. The relative one catches the case that
 * actually shipped: St. Thomas opens on drums alone, so `other` at the top
 * of that tune is bleed — it peaked at −37 dBFS, cleared the −40 floor, and
 * the round dealt half a second of nothing under the name "Only the soloist".
 *
 * −25 dB is measured rather than picked. Across the library the quietest
 * onset that is really a part sits 19.2 dB under the mix, and the loudest
 * one that is really bleed sits 31.3 dB under it; the band between them is
 * empty apart from St. Thomas at −33. Which makes it the same number as
 * EMPTY_BELOW_MIX, and for the same reason — this is that rule again, asked
 * of the half second the round opens on instead of the first two seconds.
 */
const ONSET_WINDOW = 0.5;
const ONSET_SILENT_DBFS = -40;
const ONSET_BELOW_MIX = -25;

/**
 * Measure the half second a round opens on, against the mix's own.
 *
 * Always on the encoded file the round plays, lift included, because the
 * question is whether a listener hears anything — and the lift is up to
 * 12 dB of real, audible difference. Judging the opening on the raw head
 * instead loses three cuts across the library whose parts are quiet but
 * genuinely there, Scott LaFaro's bass among them.
 */
export async function judgeOnset({ playedFile, mixFile, leadIn }) {
  const onsetPeak = await peakInWindow(playedFile, leadIn, ONSET_WINDOW);
  const mixOnset = await peakInWindow(mixFile, leadIn, ONSET_WINDOW);

  return {
    onsetPeak: onsetPeak === null ? null : Number(onsetPeak.toFixed(1)),
    onsetRelative:
      onsetPeak !== null && mixOnset !== null
        ? Number((onsetPeak - mixOnset).toFixed(1))
        : null,
  };
}

/**
 * The verdict, given the four numbers.
 *
 * Separate from the measuring so that a pass which can only honestly
 * re-measure some of them can still reach the same conclusion from the rest.
 * `rejudge-stems` is that pass: the raw head it would need for the level
 * only ever existed inside a temp directory.
 */
export function stemIsUsable({ openLevel, relativeLevel, onsetPeak, onsetRelative }) {
  return (
    openLevel !== null &&
    openLevel !== undefined &&
    openLevel > SILENT_DBFS &&
    relativeLevel !== null &&
    relativeLevel !== undefined &&
    relativeLevel > EMPTY_BELOW_MIX &&
    onsetPeak !== null &&
    onsetPeak !== undefined &&
    onsetPeak > ONSET_SILENT_DBFS &&
    onsetRelative !== null &&
    onsetRelative !== undefined &&
    onsetRelative > ONSET_BELOW_MIX
  );
}

/**
 * How far past the marker a stem first actually sounds.
 *
 * A tune that opens on a piano pickup has no horns in its first bar, so the
 * horn stem is silent where the round starts and the round opens on nothing
 * — Along Came Betty, and half a dozen others. The answer is not to refuse
 * the stem. It is to start it where it starts.
 *
 * Always at or after the cut's own marker, never before it. The marker is
 * where somebody decided the round begins, and a stem that opened earlier
 * would deal audio the full mix never plays — the same tune answered from
 * two different places depending on which layer you picked. Silence only
 * ever pushes a stem later.
 *
 * Measured against the stem's own peak rather than an absolute floor. An
 * absolute one cannot work here: it has to sit low enough for a hushed
 * ballad entry and that is also where separation residue lives, so −40 dB
 * put St. Thomas' entry at 0.18 s, which is bleed, when the tenor is at
 * 0.64. Thirty under the loudest thing in the file is the part playing, on
 * every cut in the library.
 *
 * This says nothing about whether the stem is worth playing. A file that is
 * bleed throughout still has a loudest moment and will still get an answer
 * from this — and then fail `judgeStem` at that moment, which is the check
 * that compares it against the record rather than against itself.
 */
const ONSET_BELOW_PEAK = 30;
/** Trimming may not eat the round: this much clip has to survive it. */
const KEEP_SECONDS = 10;

export async function onsetOffset(file, from, duration) {
  const peak = await filePeak(file);
  if (peak === null) return 0;

  const room = Math.max(0, (duration ?? Infinity) - from - KEEP_SECONDS);
  if (room === 0) return 0;

  /*
   * Nothing to trim if the round's own opening already sounds — and that is
   * asked over the same half second the verdict is reached over, not by
   * whether ffmpeg calls the instant of the marker silent. A horn decays
   * below any useful threshold between notes, so a detector that only
   * looked at the marker pushed St. Thomas from 0.64 to 1.36 on a gap in a
   * phrase it was already playing. The marker is the answer unless the
   * opening is genuinely empty.
   */
  const opening = await peakInWindow(file, from, ONSET_WINDOW);
  if (opening !== null && opening > peak - ONSET_BELOW_PEAK) return 0;

  try {
    const { stderr } = await run(
      "ffmpeg",
      [
        "-hide_banner", "-nostats",
        "-ss", String(from),
        "-i", file,
        "-af", `silencedetect=n=${(peak - ONSET_BELOW_PEAK).toFixed(1)}dB:d=0.1`,
        "-f", "null", "-",
      ],
      { maxBuffer: 1024 * 1024 * 8 },
    );
    // Silence that does not begin at the marker means the stem is already
    // sounding there, and there is nothing to trim.
    if (!/silence_start:\s*-?0(\.0+)?\b/.test(stderr)) return 0;
    const match = /silence_end:\s*([\d.]+)/.exec(stderr);
    if (!match) return 0;
    return Math.min(Number(match[1]), room);
  } catch {
    return 0;
  }
}

/** Length of a file in seconds, or null when ffprobe cannot say. */
async function durationOf(file) {
  try {
    const { stdout } = await run(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
      { maxBuffer: 1024 * 64 },
    );
    const seconds = Number(stdout.trim());
    return Number.isFinite(seconds) ? seconds : null;
  } catch {
    return null;
  }
}

/** Loudest sample in a whole file, in dBFS. */
async function filePeak(file) {
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
 * Judge one stem against the mix it came out of.
 *
 * Two files, deliberately, because the two questions want different ones.
 *
 * `stemFile` is the raw separator output and is where the level is measured,
 * before any gain. That order is not incidental: normalising first would
 * apply 45 dB to separation residue and hand back something at −16 LUFS that
 * measures exactly like a real horn and sounds convincingly like a smeared
 * one. Measure, judge, then amplify.
 *
 * `playedFile` is the encoded mp3 a round actually plays, and is where the
 * opening is measured — because "is there anything to hear at 0.5 s" is a
 * question about the file that gets served, and the lift is up to 12 dB of
 * real, audible difference. Judging the opening on the raw stem instead
 * throws away three cuts across the library whose parts are quiet but
 * genuinely there, Scott LaFaro's bass among them.
 *
 * Falls back to `stemFile` when there is no encode to point at yet.
 */
export async function judgeStem({ stemFile, playedFile, mixFile, leadIn }) {
  const openLevel = await levelAtMarker(stemFile, leadIn, 2);
  const mixLevel = await levelAtMarker(mixFile, leadIn, 2);
  const onset = await judgeOnset({ playedFile: playedFile ?? stemFile, mixFile, leadIn });

  const relativeLevel =
    openLevel !== null && mixLevel !== null
      ? Number((openLevel - mixLevel).toFixed(1))
      : null;

  const measured = {
    openLevel: openLevel === null ? null : Number(openLevel.toFixed(1)),
    relativeLevel,
    ...onset,
  };

  return { usable: stemIsUsable(measured), ...measured };
}

/* ------------------------------------------------------------------
   Cutting the variants.
   ------------------------------------------------------------------ */

/**
 * Bring a stem up to something playable without flattening it.
 *
 * A lead voice pulled out of a mix is much quieter than the mix, and the
 * volume slider is one setting for every clip — so a stem left at its own
 * gain is a round nobody can hear. But plain loudnorm would drag residue up
 * to the same target as music, so the gain is measured, capped, and applied
 * as a straight volume change with a limiter behind it. Loud stems are left
 * alone; quiet ones are helped as far as the cap and no further.
 */
const MAX_LIFT_DB = 12;
const TARGET_LUFS = -16;

async function measuredLift(file) {
  try {
    const { stderr } = await run(
      "ffmpeg",
      [
        "-hide_banner", "-nostats",
        "-i", file,
        "-af", `loudnorm=I=${TARGET_LUFS}:print_format=json`,
        "-f", "null", "-",
      ],
      { maxBuffer: 1024 * 1024 * 8 },
    );
    const match = /"input_i"\s*:\s*"(-?[\d.]+)"/.exec(stderr ?? "");
    if (!match) return 0;
    const measured = Number(match[1]);
    if (!Number.isFinite(measured) || measured < -70) return 0;
    return Math.max(0, Math.min(MAX_LIFT_DB, TARGET_LUFS - measured));
  } catch {
    return 0;
  }
}

async function encodeStem(inputs, output, { lift = 0 } = {}) {
  const gain = lift > 0.1 ? `volume=${lift.toFixed(1)}dB,alimiter` : "alimiter";
  const args = ["-y", "-hide_banner", "-loglevel", "error"];
  for (const input of inputs) args.push("-i", input);

  if (inputs.length > 1) {
    // normalize=0: amix otherwise divides by the input count, which would
    // quietly drop the rhythm mix ~14 dB below the record it came from.
    args.push("-filter_complex", `amix=inputs=${inputs.length}:normalize=0,${gain}`);
  } else {
    args.push("-af", gain);
  }

  args.push("-ac", "2", "-ar", "44100", "-b:a", "160k", "-map_metadata", "-1", output);
  await run("ffmpeg", args, { maxBuffer: 1024 * 1024 * 16 });
}

/* ------------------------------------------------------------------
   Which head carries the soloist.

   The model splits into six, and which of them holds the lead voice depends
   on what the lead voice is playing. A horn lands in `other`; a piano solo
   is in `piano`, and asking `other` for it returns the horns that are not
   soloing — which is the opposite of the intended game. The library already
   knows the answer: `soloistRole` is settled against the credits on every
   save, so the instrument follows the name.

   This also decides what the accompaniment is, since it is the rest of the
   band by definition. On Waltz For Debby the soloist is the piano, so the
   accompaniment is bass and drums; on Moanin' the theme is the piano, so it
   is the horns, bass and drums, and the piano is gone from it.
   ------------------------------------------------------------------ */

export const STEM_HEADS = ["other", "piano", "guitar", "bass", "drums", "vocals"];

/**
 * The four instruments a rhythm section is made of.
 *
 * Kept only for reports that ask "does this band have a rhythm section" —
 * it is no longer what the accompaniment variant is built from. See
 * `accompanimentHeadsFor` for why that changed.
 */
export const RHYTHM_HEADS = ["piano", "guitar", "bass", "drums"];

/** The variants a clip is split into. Mirrors StemId in lib/types.ts. */
export const STEM_IDS = ["lead", "rhythm", "bass"];

const HEAD_BY_INSTRUMENT = [
  [/\b(bass|contrabass|double ?bass|tuba)\b/, "bass"],
  [/\b(drum|drums|percussion|timbales|congas?)\b/, "drums"],
  [/\b(piano|keyboard|organ|celeste|harpsichord|rhodes)\b/, "piano"],
  [/\b(guitar|banjo|mandolin)\b/, "guitar"],
  [/\b(vocal|vocals|voice|sing)/, "vocals"],
];

/**
 * The head a soloist's instrument lands in.
 *
 * Anything not named above is `other`, which is where every horn goes and is
 * the right default: a role this does not recognise is far more likely to be
 * an instrument the model lumps in with the horns — flugelhorn, bass
 * clarinet, vibraphone — than a rhythm instrument, and those are all listed.
 *
 * A role can name several instruments ("Clarinet, Tenor Saxophone"), and the
 * first match wins rather than the first instrument, so the rhythm-section
 * readings are preferred — a player credited "Piano, Trumpet" who is being
 * asked about is much more likely to be at the piano.
 *
 * It is tempting to also check whether the band has a horn or a singer, and
 * refuse a rhythm instrument as lead whenever one exists — Moanin' looks
 * exactly like that failure: nobody ever named its soloist, the fallback in
 * `resolveSoloist` landed on the bandleader, and Art Blakey's own credit
 * says "Drums", so the record played a drum solo under "Only the soloist"
 * despite Lee Morgan and Benny Golson being right there on the session.
 *
 * But Freddie Freeloader, Cantaloupe Island, Song For My Father, and Take
 * Five are the identical shape — a horn-playing band, a soloist credited on
 * piano — and are correct: Wynton Kelly, Herbie Hancock, Horace Silver, and
 * Dave Brubeck really are the ones soloing on those records, horns in the
 * band notwithstanding. Checking the credits cannot tell that apart from
 * Moanin', because the fact that decides it — who is actually playing on
 * the marked clip — is not in the credits. It is only in the recording.
 *
 * So this stays a plain lookup, and a soloist that turns out to be wrong is
 * a library-screen fix, one record at a time, not a rule this function can
 * be taught.
 */
export function leadStemFor(role) {
  const text = String(role ?? "").toLowerCase();
  for (const [pattern, head] of HEAD_BY_INSTRUMENT) {
    if (pattern.test(text)) return head;
  }
  return "other";
}

/**
 * The head carrying the melody, for a cut where nobody is soloing yet.
 *
 * The top of a tune is the head: the theme, stated by the band before
 * anybody takes it anywhere. Asking who is soloing there is asking the
 * wrong question — nobody is — and answering it with the credited soloist's
 * instrument is what put Art Blakey's drums out front on Moanin' and took
 * his drums out of the rhythm section at the same time, on a record whose
 * theme is Lee Morgan and Benny Golson playing in harmony.
 *
 * So this asks the question that cut actually poses: who has the melody.
 * A singer if the record has one, the horns if it has those, and otherwise
 * the soloist's own instrument — which is the trio case, where the piano or
 * the guitar states the theme because there is nothing else to state it.
 */
/**
 * The heads carrying the theme, as named on the record.
 *
 * `melody` is a list of people, the same shape the soloist is: somebody
 * listened to the top of the tune and said who has it. Several of them,
 * because a theme is routinely stated in harmony — two horns, or a horn
 * and the piano — and there is no reason to make that one name.
 *
 * Deriving it from the credits, which is what this did before, could only
 * ever answer "what instruments are on this record". That is a different
 * question, and it gets Sing Sing Sing wrong: the session has a singer
 * credited, the tune is an instrumental, and no amount of reading the
 * personnel turns that into the clarinet actually playing it.
 *
 * Falls back to the derivation when nobody has said. A hundred and forty
 * cuts do not become unplayable because a field is new.
 */
export function melodyHeadsFor({ personnel, melody, role, artist }) {
  const named = (melody ?? []).map((name) => normalizeName(name)).filter(Boolean);

  if (named.length > 0) {
    const heads = new Set();
    for (const credit of personnel ?? []) {
      if (named.includes(normalizeName(credit?.name))) heads.add(leadStemFor(credit?.role));
    }
    /*
     * Names matching nobody in the credits leave nothing to lift out, and an
     * empty lead would quietly become "the whole record". Falling through to
     * the guess is worse than the answer somebody gave and better than a
     * variant with no heads in it.
     */
    if (heads.size > 0) return [...heads];
  }

  return [melodyStemFor(personnel, role, artist)];
}

export function melodyStemFor(personnel, role, artist) {
  let sawHorn = false;
  for (const credit of personnel ?? []) {
    const text = String(credit?.role ?? "").toLowerCase();
    if (!text) continue;
    let head = "other";
    for (const [pattern, mapped] of HEAD_BY_INSTRUMENT) {
      if (pattern.test(text)) {
        head = mapped;
        break;
      }
    }
    // A singer outranks a horn: on a vocal record the horns are the setting.
    if (head === "vocals") return "vocals";
    if (head === "other") sawHorn = true;
  }
  if (sawHorn) return "other";

  /*
   * No horn and no singer, so the theme belongs to whoever leads the group —
   * the piano in a piano trio, the guitar in a guitar trio.
   *
   * The leader rather than the soloist, because a recording with two
   * soloists marked on it is two entries over one head clip, and the head
   * clip is the same twenty seconds either way. Read from the soloist it
   * gave Gloria's Step a piano theme under Bill Evans' entry and a bass
   * theme under Scott LaFaro's — one clip, two answers, and the tune only
   * has one. The leader is a property of the recording, so siblings agree.
   */
  const wanted = normalizeName(artist);
  if (wanted) {
    const leader = (personnel ?? []).find((c) => normalizeName(c?.name) === wanted);
    if (leader?.role) return leadStemFor(leader.role);
  }
  return leadStemFor(role);
}

/** Matches `resolveSoloist`, so the leader is found by the same spelling. */
function normalizeName(name) {
  return String(name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The head out front, for the cut in hand.
 *
 * The two cuts are different moments and want different answers, which is
 * the thing this file used to get wrong by answering both from
 * `soloistRole`. On the solo cut somebody is soloing and the library says
 * who, so their instrument is the lead. On the head cut nobody is, so the
 * melody is.
 */
export function leadHeadsFor({ cut, role, personnel, melody, artist }) {
  if (cut === "solo") return [leadStemFor(role)];
  return melodyHeadsFor({ personnel, melody, role, artist });
}

/**
 * The accompaniment: this record, less whoever has the tune.
 *
 * Defined by subtraction, and deliberately so. It was four fixed
 * instruments — piano, guitar, bass, drums — which is what a rhythm section
 * is, and that is the right answer to "who is the rhythm section" and the
 * wrong answer to the question the game actually asks. On Moanin' the piano
 * states the theme and the horns answer it; a rhythm section defined as
 * those four instruments then plays the piano that just had the melody and
 * drops the horns that were the accompaniment. Two things were wrong at
 * once: the melody was audible in the layer it had been taken out of, and
 * the band that was accompanying it was not.
 *
 * So the pair is now what its names say. Melody is the instrument or
 * instruments named — the soloist on a solo cut, whoever states the theme on
 * the opening — and accompaniment is everything else the record contains,
 * horns included.
 *
 * The credits still decide what "contains" means, and that is not a
 * leftover: a head with nobody behind it holds bleed rather than silence,
 * and the loudest thing to bleed into it is usually whatever has the tune.
 * Mixing it in would put a ghost of the melody back into the layer this
 * exists to take it out of.
 */
export function accompanimentHeadsFor(args) {
  const lead = leadHeadsFor(args);
  const present = headsInCredits(args.personnel);
  return STEM_HEADS.filter((head) => !lead.includes(head) && present.has(head));
}

/**
 * The heads that have an instrument behind them on this record.
 *
 * A head the band does not contain is not empty — it is bleed, and on these
 * recordings it is loud bleed. Measured on the solo cut of So What, which
 * has no guitarist: the `guitar` head sits at −33.3 dB mean with peaks to
 * −1.7 dB, and what is in it is Miles and Coltrane. `rhythm` is assembled
 * from every head except the lead, so that horn goes straight back into the
 * mix that is supposed to have had the horn taken out of it — which is why
 * Giant Steps plays a tenor saxophone in "Only the rhythm section".
 *
 * So the credits decide. Every head a credited role could plausibly be is
 * kept, deliberately generously: a player billed "Piano, Trumpet" holds both
 * `piano` and `other` open, because including a head that turns out to be
 * bleed only restores today's behaviour, while dropping one that holds a
 * real part silently deletes a musician.
 *
 * Empty or unreadable credits mean no opinion, and no opinion means every
 * head — the same answer this had before there was a check.
 */
export function headsInCredits(personnel) {
  const roles = (personnel ?? [])
    .map((credit) => String(credit?.role ?? "").toLowerCase())
    .filter(Boolean);
  if (roles.length === 0) return new Set(STEM_HEADS);

  const heads = new Set();
  for (const text of roles) {
    let matched = false;
    for (const [pattern, head] of HEAD_BY_INSTRUMENT) {
      if (pattern.test(text)) {
        heads.add(head);
        matched = true;
      }
    }
    // Anything the list does not name is a horn, which is where `other` goes.
    if (!matched) heads.add("other");
  }
  return heads;
}

/**
 * What a variant of a clip is called on disk.
 *
 * `lead` and `rhythm` carry the head they were built around, and that is not
 * decoration. A recording with several soloists on it is several entries in
 * the library sharing one head clip — Stolen Moments is four — and each of
 * them resolves its own lead head from its own soloist. Named by the cut
 * alone they all land on `<clip>--lead.mp3`, so splitting the fourth entry
 * overwrites the first three, and every one of them ends up pointing at
 * whichever head happened to go last. That shipped: three entries claiming
 * `other` and one claiming `piano`, all four naming the same file, at most
 * one of them telling the truth.
 *
 * `bass` is always the bass head, so it has nothing to disambiguate and
 * keeps its plain name.
 */
export function stemFileName(clipId, id, leadHeads) {
  if (id === "bass") return `${clipId}--bass.mp3`;
  const heads = Array.isArray(leadHeads) ? leadHeads : [leadHeads];
  return `${clipId}--${id}-${[...heads].sort().join("-")}.mp3`;
}

/**
 * What a cut's split would come out as, as one comparable string.
 *
 * The heads that go into a variant are the whole of what makes it the audio
 * it is, so two cuts with the same shape produce the same files and a cut
 * whose shape has changed is holding audio for a question nobody is asking
 * any more. That is what the library screen compares across a save: not the
 * fields somebody edited, but whether editing them moved this. Correcting a
 * spelling in the credits does not, and does not cost an hour of separating.
 */
export function splitShapeFor(args) {
  return `${leadHeadsFor(args).join("+")}|${accompanimentHeadsFor(args).join("+")}`;
}

/**
 * Split one clip into its playable variants.
 *
 * `clipId` is the clip's filename stem, and the variants are named after it
 * with a suffix — the same shape `--solo` already uses, so one flat folder
 * still holds every clip and the name says which cut it is. Demucs' own
 * output never reaches that folder: it writes `no_other` and friends, and an
 * underscore does not survive the filename check the audio route applies.
 *
 * `leadIn` has to come from the record rather than from PRE_ROLL. The clips
 * in the library were cut under several generations of those constants and
 * a clip's own lead-in is the only thing that says where its round opens.
 *
 * `role` is the soloist's instrument, which decides which head is the lead
 * and therefore what the rhythm mix has left in it.
 */
export async function separateClip({
  clipId, leadIn, cut, role, personnel, melody, artist, previous, onProgress,
}) {
  const log = onProgress ?? (() => {});
  const mixFile = path.join(AUDIO_DIR, `${clipId}.mp3`);
  if (!existsSync(mixFile)) throw new Error(`No clip on disk: ${clipId}.mp3`);

  await ensureSeparator({ onProgress });

  const clipSeconds = await durationOf(mixFile);
  const work = await mkdtemp(path.join(tmpdir(), "heardzz-stems-"));
  try {
    log("separating");
    await run(
      DEMUCS,
      ["-n", MODEL, "-o", work, mixFile],
      { maxBuffer: 1024 * 1024 * 32, env: { ...process.env, ...MODEL_ENV } },
    );

    const produced = path.join(work, MODEL, clipId);
    const files = await readdir(produced).catch(() => []);
    if (files.length === 0) throw new Error("the separator produced nothing");

    const stem = (name) => path.join(produced, `${name}.wav`);
    const shape = { cut, role, personnel, melody, artist };
    const leadHeads = leadHeadsFor(shape);
    const results = {};

    /*
     * Every variant is judged on the raw separator output, before any gain,
     * and the encode below is where the gain goes on. The other order looks
     * equivalent and is not: normalising first lifts separation residue by
     * forty-odd dB and hands back something that measures like a real part.
     */
    const write = async (id, heads, { lift = true } = {}) => {
      const inputs = heads.map(stem).filter((file) => existsSync(file));
      if (inputs.length === 0) return;

      const name = stemFileName(clipId, id, leadHeads);
      const out = path.join(AUDIO_DIR, name);

      log(`encoding ${id}`);
      await encodeStem(inputs, out, {
        lift: lift && inputs.length === 1 ? await measuredLift(inputs[0]) : 0,
      });

      /*
       * A human yes is about a sound, and the sound is the heads that were
       * mixed. Re-separating the same clip with the same model and the same
       * heads reproduces it, so the ruling stands; change the heads and it
       * is a different mix nobody has heard, so the ruling goes.
       */
      const before = previous?.[id];
      const sameMix =
        Array.isArray(before?.heads) &&
        before.heads.length === heads.length &&
        before.heads.every((head, i) => head === heads[i]);

      /*
       * Where this variant's own round opens. Carried over rather than
       * re-detected when the mix is unchanged, because the same heads
       * produce the same file and the answer would be the same — and
       * because a start somebody set by hand in the library screen is a
       * judgement, which a re-split has no business overruling.
       */
      const start =
        sameMix && typeof before.leadIn === "number"
          ? before.leadIn
          : Number((leadIn + (await onsetOffset(out, leadIn, clipSeconds))).toFixed(3));

      results[id] = {
        audio: `/api/audio/${name}`,
        head: heads.length === 1 ? heads[0] : undefined,
        heads,
        leadIn: start,
        ...(sameMix && before.approved !== undefined ? { approved: before.approved } : {}),
        /*
         * The level comes off the raw head and the opening off the encode —
         * see `judgeStem`. A mix of several heads has no single raw head to
         * point at, and judging its parts separately would be judging things
         * nobody hears on their own, so it is measured whole after it is
         * assembled.
         *
         * Judged at the variant's own start, since that is where its round
         * begins. Measuring the horns over a piano pickup they are not in
         * answers a question nobody is going to ask of them.
         */
        ...(await judgeStem({
          stemFile: inputs.length === 1 ? inputs[0] : out,
          playedFile: out,
          mixFile,
          leadIn: start,
        })),
      };
    };

    await write("lead", leadHeads);
    await write("rhythm", accompanimentHeadsFor(shape), { lift: false });
    /*
     * Bass is its own mode rather than a special case of lead: on most of
     * these records the bassist is not the soloist, and hearing the walk on
     * its own is a different puzzle from hearing whoever is out front. When
     * the soloist *is* the bassist the two variants are the same audio, and
     * that is correct rather than redundant.
     */
    await write("bass", ["bass"]);

    for (const fallback of BASS_FALLBACK_MODELS) {
      if (results.bass?.usable) break;
      log(`bass came back empty — trying ${fallback}`);
      const second = path.join(work, fallback);
      await run(
        DEMUCS,
        ["-n", fallback, "-o", second, mixFile],
        { maxBuffer: 1024 * 1024 * 32, env: { ...process.env, ...MODEL_ENV } },
      );
      const file = path.join(second, fallback, clipId, "bass.wav");
      if (!existsSync(file)) continue;

      /*
       * Encoded into the work directory rather than over the answer already
       * on disk. The opening can only be judged on the encode, and a verdict
       * that comes back worse must leave the first model's bass where it is
       * rather than having replaced it on the way to finding that out.
       */
      const candidate = path.join(second, `${clipId}--bass.mp3`);
      await encodeStem([file], candidate, { lift: await measuredLift(file) });
      const verdict = await judgeStem({
        stemFile: file,
        playedFile: candidate,
        mixFile,
        leadIn,
      });
      // Only kept if it is actually better; a second empty answer is not news.
      if (!verdict.usable) continue;

      const out = path.join(AUDIO_DIR, `${clipId}--bass.mp3`);
      await rename(candidate, out).catch(async () => {
        await copyFile(candidate, out);
      });
      const before = previous?.bass;
      results.bass = {
        audio: `/api/audio/${clipId}--bass.mp3`,
        head: "bass",
        heads: ["bass"],
        model: fallback,
        // Same head, and a fallback only reached when the first model found
        // nothing — so a standing yes was given for this file, not that one.
        ...(before?.model === fallback && before.approved !== undefined
          ? { approved: before.approved }
          : {}),
        ...verdict,
      };
    }

    /*
     * And every head on its own, kept for listening rather than for playing.
     *
     * The three variants above answer "what does this mode sound like". They
     * cannot answer the question that actually comes up when one of them is
     * wrong, which is where the missing part went — a plucked upright the
     * six-stem model routed into `guitar`, a piano smeared through `other`.
     * That is only ever settled by hearing the heads themselves, and by then
     * the separator's own output is a deleted temp directory.
     *
     * So they are written out beside the variants and thrown away again on
     * the next save. Twelve files per record is real disk, and their whole
     * job is to be listened to once while somebody works out what happened.
     */
    const sources = [];
    const rawHeads = STEM_HEADS.filter((head) => existsSync(stem(head)));

    /*
     * One gain for all six, and it is the gain the loudest of them asks for.
     *
     * The variants above are each lifted to a target, which is right for
     * something that has to be playable next to the full mix. It is wrong
     * here and was actively misleading: a head with nothing in it asks for
     * the full twelve decibels, gets them, and hands back separation residue
     * — a faint copy of the whole band — at the same loudness as a head that
     * holds a real instrument. Every head then sounds like it contains
     * everything, which is the opposite of what these are for.
     *
     * Lifting them all by the same amount keeps them in the proportion the
     * separator left them in, so an empty head sounds empty and a head with
     * the piano in it is obviously the loud one.
     */
    const lifts = await Promise.all(rawHeads.map((head) => measuredLift(stem(head))));
    const commonLift = lifts.length > 0 ? Math.min(...lifts) : 0;

    for (const head of rawHeads) {
      const raw = stem(head);
      const name = `${clipId}--source-${head}.mp3`;
      log(`encoding ${head}`);
      await encodeStem([raw], path.join(AUDIO_DIR, name), { lift: commonLift });
      sources.push({
        head,
        audio: `/api/audio/${name}`,
        level: await levelAtMarker(raw, leadIn, 2),
      });
    }

    return { stems: results, sources };
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Every file `separateClip` has written for a clip.
 *
 * Read off the directory rather than enumerated. It used to be a list of
 * every name the scheme could produce, which worked while a variant was
 * named after one head — now a lead can be several, the combinations are
 * not worth listing, and a name this failed to think of is a file left on
 * the volume forever. Asking what is actually there also sweeps up the
 * shapes earlier versions wrote.
 */
export async function stemFilesFor(clipId) {
  const names = await readdir(AUDIO_DIR).catch(() => []);
  return names.filter((name) => name.startsWith(`${clipId}--`) && name.endsWith(".mp3"));
}
