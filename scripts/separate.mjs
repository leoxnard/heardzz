/* ------------------------------------------------------------------
   Pulling a recording apart.

   A clip is a mix. This takes one and produces three more: the lead voice on
   its own, everything except the lead voice, and the bass. On a Blue Note
   quintet those are the horn, the rhythm section, and the walk — three quite
   different games. One asks you to name a player by their sound alone, one
   to name a record with its most obvious clue removed, and one to do it on
   four notes a bar.

   Which head holds the lead voice depends on who is soloing, so it is not
   fixed: see `leadStemFor` below.

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
import { mkdtemp, rm, mkdir, readdir, writeFile, readFile } from "node:fs/promises";
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
 */
const ONSET_WINDOW = 0.5;
const ONSET_SILENT_DBFS = -40;

/**
 * Judge one stem against the mix it came out of.
 *
 * Everything is measured on the raw stem, before any gain. That order is not
 * incidental: normalising first would apply 45 dB to separation residue and
 * hand back something at −16 LUFS that measures exactly like a real horn and
 * sounds convincingly like a smeared one. Measure, judge, then amplify.
 */
export async function judgeStem({ stemFile, mixFile, leadIn }) {
  const openLevel = await levelAtMarker(stemFile, leadIn, 2);
  const mixLevel = await levelAtMarker(mixFile, leadIn, 2);
  const onsetPeak = await peakInWindow(stemFile, leadIn, ONSET_WINDOW);

  const relativeLevel =
    openLevel !== null && mixLevel !== null
      ? Number((openLevel - mixLevel).toFixed(1))
      : null;

  const usable =
    openLevel !== null &&
    openLevel > SILENT_DBFS &&
    relativeLevel !== null &&
    relativeLevel > EMPTY_BELOW_MIX &&
    onsetPeak !== null &&
    onsetPeak > ONSET_SILENT_DBFS;

  return {
    usable,
    openLevel: openLevel === null ? null : Number(openLevel.toFixed(1)),
    relativeLevel,
    onsetPeak: onsetPeak === null ? null : Number(onsetPeak.toFixed(1)),
  };
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

   This also decides what `rhythm` means. "The band without the soloist" is
   only the same thing as "everything but the horns" on a record where the
   soloist is a horn player — on Waltz For Debby the soloist is the piano,
   and subtracting the horns from a piano trio subtracts nothing at all.
   ------------------------------------------------------------------ */

export const STEM_HEADS = ["other", "piano", "guitar", "bass", "drums", "vocals"];

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
 */
export function leadStemFor(role) {
  const text = String(role ?? "").toLowerCase();
  for (const [pattern, head] of HEAD_BY_INSTRUMENT) {
    if (pattern.test(text)) return head;
  }
  return "other";
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
export async function separateClip({ clipId, leadIn, role, onProgress }) {
  const log = onProgress ?? (() => {});
  const mixFile = path.join(AUDIO_DIR, `${clipId}.mp3`);
  if (!existsSync(mixFile)) throw new Error(`No clip on disk: ${clipId}.mp3`);

  await ensureSeparator({ onProgress });

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
    const leadHead = leadStemFor(role);
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

      const out = path.join(AUDIO_DIR, `${clipId}--${id}.mp3`);
      const verdict =
        inputs.length === 1
          ? await judgeStem({ stemFile: inputs[0], mixFile, leadIn })
          : null;

      log(`encoding ${id}`);
      await encodeStem(inputs, out, {
        lift: lift && inputs.length === 1 ? await measuredLift(inputs[0]) : 0,
      });

      results[id] = {
        audio: `/api/audio/${clipId}--${id}.mp3`,
        head: heads.length === 1 ? heads[0] : undefined,
        /*
         * A mix of several heads is judged after it is assembled, because
         * what matters is whether the thing that will be played has anything
         * in it. Judging it before would mean judging parts nobody hears
         * on their own.
         */
        ...(verdict ?? (await judgeStem({ stemFile: out, mixFile, leadIn }))),
      };
    };

    await write("lead", [leadHead]);
    await write("rhythm", STEM_HEADS.filter((head) => head !== leadHead), { lift: false });
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

      const verdict = await judgeStem({ stemFile: file, mixFile, leadIn });
      // Only kept if it is actually better; a second empty answer is not news.
      if (!verdict.usable) continue;

      const out = path.join(AUDIO_DIR, `${clipId}--bass.mp3`);
      await encodeStem([file], out, { lift: await measuredLift(file) });
      results.bass = {
        audio: `/api/audio/${clipId}--bass.mp3`,
        head: "bass",
        model: fallback,
        ...verdict,
      };
    }

    return results;
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

/** Every file `separateClip` may have written for a clip. */
export function stemFilesFor(clipId) {
  return STEM_IDS.map((id) => `${clipId}--${id}.mp3`);
}
