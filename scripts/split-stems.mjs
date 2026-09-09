/* ------------------------------------------------------------------
   Pull every clip apart.

     node scripts/split-stems.mjs [--only <id>] [--force] [--head-only]

   Each record has one or two cuts — the head clip, and the solo clip when
   somebody has marked a solo entry — and each cut gets two more files beside
   it: the lead voice alone, and everything but the lead voice.

   Records where the lead voice turns out to be nothing are not a failure and
   are not skipped: the files are written, the verdict is recorded, and the
   game declines to deal them at that stem. A piano trio has no horn, and the
   only way to know that for a given twenty seconds is to look.

   The first run builds the separator, which is a gigabyte and takes a while.
   Every run after it goes straight to work.
   ------------------------------------------------------------------ */

import { readLibrary, writeLibrary } from "./extract.mjs";
import {
  ensureSeparator, leadHeadsFor, rhythmHeadsFor, separateClip, separatorIsReady,
} from "./separate.mjs";

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const force = args.includes("--force");
const headOnly = args.includes("--head-only");
const plan = args.includes("--plan");

const library = await readLibrary();

/*
 * One entry per cut rather than per record. `apply` is how the result gets
 * back onto the right half of the record, which differs between the two:
 * the head clip's fields live directly on the Solo and the solo cut's live
 * on a nested object.
 */
const cuts = [];
for (const solo of library.solos) {
  if (only && solo.id !== only) continue;

  const head = {
    label: `${solo.artist} — ${solo.song}`,
    clipId: solo.audio ? basename(solo.audio) : null,
    leadIn: solo.leadIn,
    cut: "head",
    role: solo.soloistRole,
    personnel: solo.personnel,
    melody: solo.melody,
    artist: solo.artist,
    previous: solo.stems,
    has: () => Boolean(solo.stems),
    apply: (stems) => { solo.stems = stems; },
  };
  if (head.clipId) cuts.push(head);

  if (!headOnly && solo.soloClip) {
    cuts.push({
      label: `${solo.artist} — ${solo.song} (solo)`,
      clipId: basename(solo.soloClip.audio),
      leadIn: solo.soloClip.leadIn,
      cut: "solo",
      role: solo.soloistRole,
      personnel: solo.personnel,
      melody: solo.melody,
      artist: solo.artist,
      previous: solo.soloClip.stems,
      has: () => Boolean(solo.soloClip.stems),
      apply: (stems) => { solo.soloClip.stems = stems; },
    });
  }
}

function basename(audio) {
  return audio.split("/").pop().replace(/\.mp3$/, "");
}

/**
 * What makes two cuts the same job.
 *
 * A recording with four soloists on it is four entries sharing one head
 * clip, and separating it four times produces four identical sets of files
 * — an hour of a 2013 laptop CPU each, for nothing. What actually varies
 * between siblings is which head is the lead and which heads the credits
 * allow into the rhythm mix, so that is the key; everything with the same
 * answer to both gets the first one's result.
 */
const shapeOf = (cut) => ({
  cut: cut.cut, role: cut.role, personnel: cut.personnel,
  melody: cut.melody, artist: cut.artist,
});

function jobKey(cut) {
  return `${cut.clipId}:${shapeOf(cut)}`;
}

/*
 * What each cut would be split into, without splitting anything.
 *
 * Separating the library is an hour and three quarters on the machine this
 * runs on, and almost none of that time is spent deciding which heads go
 * where — that part is the credits and one lookup, and it is also the part
 * that has been wrong twice. So it can be read on its own, in a second,
 * before committing the afternoon to it.
 *
 * `on disk` says whether the files already match: the heads that went into
 * a variant are stored on it, so a plan can be checked against what is
 * actually there rather than against what was last intended.
 */
if (plan) {
  const label = (heads) => (heads.length === 0 ? "—" : heads.join("+"));
  let stale = 0;

  for (const cut of cuts) {
    const lead = leadHeadsFor(shapeOf(cut));
    const rhythm = rhythmHeadsFor(shapeOf(cut));

    const have = cut.previous;
    const matches =
      have?.lead?.heads?.join("+") === lead.join("+") &&
      have?.rhythm?.heads?.join("+") === label(rhythm);
    if (!matches) stale += 1;

    console.log(
      `${matches ? "  " : "→ "}${cut.label.padEnd(46)} ` +
        `lead ${label(lead).padEnd(14)} rhythm ${label(rhythm).padEnd(24)}` +
        `${have ? (matches ? "on disk" : "needs splitting") : "not split yet"}`,
    );
  }

  console.log(
    `\n${cuts.length} cut(s). ${cuts.length - stale} already match, ${stale} would change.`,
  );
  process.exit(0);
}

const targets = cuts.filter((cut) => force || !cut.has());

if (targets.length === 0) {
  console.log("Nothing to split.");
  process.exit(0);
}

if (!separatorIsReady()) {
  console.log("Building the separator. This downloads about a gigabyte, once.\n");
  await ensureSeparator({ onProgress: (step) => console.log(`  ${step}`) });
  console.log();
}

console.log(`Splitting ${targets.length} cut${targets.length === 1 ? "" : "s"}.\n`);

/** Results already produced in this run, by the job they answer. */
const done = new Map();

let empty = 0;
let failed = 0;
let reused = 0;
let split = 0;
const startedAt = Date.now();

/** Whole seconds as h:mm:ss, for a run measured in hours. */
function elapsed(ms) {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

for (const [index, cut] of targets.entries()) {
  /*
   * Numbered and stamped because this runs for hours behind `docker exec -d`
   * with nothing to look at but a log file. A line that says only which
   * record is in hand cannot answer "how far along is it" or "is it still
   * moving", which are the two questions anybody actually has.
   */
  process.stdout.write(
    `[${index + 1}/${targets.length}] ${elapsed(Date.now() - startedAt)}  ${cut.label}\n`,
  );
  try {
    const key = jobKey(cut);
    const already = done.get(key);
    if (already) {
      console.log("  same clip and same lead as a cut already done — reusing it\n");
      cut.apply(structuredClone(already));
      await writeLibrary(library);
      reused += 1;
      continue;
    }

    const stems = await separateClip({
      clipId: cut.clipId,
      leadIn: cut.leadIn,
      cut: cut.cut,
      role: cut.role,
      personnel: cut.personnel,
      melody: cut.melody,
      artist: cut.artist,
      previous: cut.previous,
      onProgress: (step) => process.stdout.write(`  ${step}\n`),
    });

    cut.apply(stems);
    done.set(key, stems);
    split += 1;

    for (const [id, variant] of Object.entries(stems)) {
      const verdict = variant.usable ? "ok" : "EMPTY — will not be dealt";
      const from = variant.head ? ` from ${variant.head}` : "";
      console.log(
        `  ${id.padEnd(6)}${from.padEnd(12)} ${verdict}` +
          `  (${variant.openLevel} dBFS, ${variant.relativeLevel} dB under the mix)`,
      );
      if (!variant.usable) empty += 1;
    }

    // Written as we go, so an interrupted run keeps what it has split.
    await writeLibrary(library);
    console.log();
  } catch (error) {
    failed += 1;
    console.log(`  failed: ${error.message.split("\n")[0]}\n`);
  }
}

if (empty > 0) {
  console.log(
    `${empty} variant(s) had nothing in them and are marked unusable. ` +
      "That is the expected answer for a record with no lead voice.",
  );
}

/*
 * Always printed, and last. Without it a log that stops has two readings —
 * finished, or died — and no way to tell them apart.
 */
console.log(
  `\nDone in ${elapsed(Date.now() - startedAt)}. ` +
    `${split} separated, ${reused} reused, ${failed} failed, ` +
    `${targets.length} cut(s) in all.`,
);
if (failed > 0) {
  console.log("The failures are named above and were left unsplit; re-running retries them.");
}
