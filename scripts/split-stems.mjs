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
import { ensureSeparator, separateClip, separatorIsReady } from "./separate.mjs";

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const force = args.includes("--force");
const headOnly = args.includes("--head-only");

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
    role: solo.soloistRole,
    has: () => Boolean(solo.stems),
    apply: (stems) => { solo.stems = stems; },
  };
  if (head.clipId) cuts.push(head);

  if (!headOnly && solo.soloClip) {
    cuts.push({
      label: `${solo.artist} — ${solo.song} (solo)`,
      clipId: basename(solo.soloClip.audio),
      leadIn: solo.soloClip.leadIn,
      role: solo.soloistRole,
      has: () => Boolean(solo.soloClip.stems),
      apply: (stems) => { solo.soloClip.stems = stems; },
    });
  }
}

function basename(audio) {
  return audio.split("/").pop().replace(/\.mp3$/, "");
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

let empty = 0;
for (const cut of targets) {
  process.stdout.write(`${cut.label}\n`);
  try {
    const stems = await separateClip({
      clipId: cut.clipId,
      leadIn: cut.leadIn,
      role: cut.role,
      onProgress: (step) => process.stdout.write(`  ${step}\n`),
    });

    cut.apply(stems);

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
    console.log(`  failed: ${error.message.split("\n")[0]}\n`);
  }
}

if (empty > 0) {
  console.log(
    `${empty} variant(s) had nothing in them and are marked unusable. ` +
      "That is the expected answer for a record with no lead voice.",
  );
}
