/* ------------------------------------------------------------------
   Re-measure the stems that are already on disk.

     node scripts/rejudge-stems.mjs [--write] [--prune] [--only <id>]

   Splitting a record is expensive and the verdict on a stem is cheap, so the
   two are not the same pass. When the rule for "is there anything here"
   changes, every stem in the library is holding an answer to the old
   question — and `split-stems` will not revisit it, because the files exist
   and that is all it checks.

   This reads the mp3s that are already there, re-measures what can honestly
   be measured on them, and writes the verdicts back. No separator, no model
   weights, no gigabyte: it is ffmpeg over files that have already been cut,
   which is minutes rather than hours and runs on a machine with no venv at
   all.

   What it will not do is second-guess the level. That number belongs to the
   raw head, which is gone, and re-reading it off the encode reads 12 dB
   loud — enough to hand back exactly the stems this is meant to remove. So
   the level stands as it was measured and only the opening is re-judged,
   which makes this a pass that can take a stem out of play and never put
   one back in.

   `--prune` deletes the ones that come back empty. The game does not need
   this — `usable: false` is what keeps a stem out of the pool, and the file
   is never requested — but a stem that cannot be served is easier to reason
   about when it is not there. Keeping them is the cheaper default: a later
   change to the thresholds can be answered by running this again, while a
   pruned library has to go back through the separator.
   ------------------------------------------------------------------ */

import { unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

import { AUDIO_DIR, readLibrary, writeLibrary } from "./extract.mjs";
import { judgeOnset, stemIsUsable, STEM_IDS } from "./separate.mjs";

const args = process.argv.slice(2);
const write = args.includes("--write");
const prune = args.includes("--prune");
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;

const library = await readLibrary();

/*
 * The head clip and the solo cut are judged the same way and differ only in
 * where their fields live, so they are flattened into one list the way
 * `split-stems` does it.
 */
const cuts = [];
for (const solo of library.solos) {
  if (only && solo.id !== only) continue;
  if (solo.stems) {
    cuts.push({ label: solo.id, audio: solo.audio, leadIn: solo.leadIn, stems: solo.stems });
  }
  if (solo.soloClip?.stems) {
    cuts.push({
      label: `${solo.id} (solo)`,
      audio: solo.soloClip.audio,
      leadIn: solo.soloClip.leadIn,
      stems: solo.soloClip.stems,
    });
  }
}

if (cuts.length === 0) {
  console.log("Nothing split yet — run split-stems first.");
  process.exit(0);
}

const clipOf = (audio) => path.basename(audio).replace(/\.mp3$/, "");

let changed = 0;
let missing = 0;
let pruned = 0;

for (const cut of cuts) {
  const clipId = clipOf(cut.audio);
  const mixFile = path.join(AUDIO_DIR, `${clipId}.mp3`);
  if (!existsSync(mixFile)) {
    console.log(`? ${cut.label}: no mix on disk, skipped`);
    missing += 1;
    continue;
  }

  for (const id of STEM_IDS) {
    const variant = cut.stems[id];
    if (!variant) continue;

    const file = path.join(AUDIO_DIR, `${clipId}--${id}.mp3`);
    if (!existsSync(file)) {
      /*
       * Already pruned, or never written. Either way the stored verdict is
       * the only thing left saying so, and overwriting it with a measurement
       * of a file that is not there would say the opposite.
       */
      if (variant.usable) {
        console.log(`! ${cut.label} ${id}: marked usable but the file is gone`);
        variant.usable = false;
        changed += 1;
      }
      continue;
    }

    /*
     * Only the opening is re-measured. The level wants the raw separator
     * output, and that only ever existed inside a temp directory — all that
     * is left on disk is the encode, which has the lift on it.
     *
     * Measuring the level there anyway looks like a small inaccuracy in the
     * generous direction and is not. It reads up to 12 dB louder, which is
     * enough to promote the exact failure this whole pass exists to catch:
     * a separation that ran and left the entire band in the lead stem, so
     * the "soloist" measures as loud as the record. Run that way over the
     * live library it moved seven of them from empty to playable, Stolen
     * Moments among them at 7.6 dB *above* its own mix.
     *
     * So the stored level stands, the opening is measured fresh, and the
     * verdict is taken from both. Which means this pass can only ever take
     * a stem out of play, never put one in on numbers it did not measure.
     */
    const onset = await judgeOnset({ playedFile: file, mixFile, leadIn: cut.leadIn });
    const usable = stemIsUsable({
      openLevel: variant.openLevel,
      relativeLevel: variant.relativeLevel,
      ...onset,
    });

    const was = variant.usable;
    Object.assign(variant, onset, { usable });

    if (was !== usable) {
      changed += 1;
      console.log(
        `${was ? "-" : "+"} ${cut.label.padEnd(38)} ${id.padEnd(6)} ` +
          `${was ? "ok → EMPTY" : "EMPTY → ok"}  ` +
          `(opening ${onset.onsetPeak} dBFS, ${onset.onsetRelative} dB against the mix)`,
      );
    }

    if (prune && !verdict.usable && write) {
      await unlink(file).catch(() => {});
      pruned += 1;
    }
  }
}

console.log(
  `\n${changed} verdict(s) changed across ${cuts.length} cut(s).` +
    (missing ? ` ${missing} cut(s) had no mix on disk.` : "") +
    (prune ? ` ${pruned} file(s) deleted.` : ""),
);

if (write) {
  await writeLibrary(library);
  console.log("Written.");
} else {
  console.log("Dry run. Pass --write to save.");
}
