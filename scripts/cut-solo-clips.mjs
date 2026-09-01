/* ------------------------------------------------------------------
   Cut the second clip: the one that opens on the solo.

     node scripts/cut-solo-clips.mjs [--only <id>] [--force]

   The clip a record ships with starts at the top of the tune, and the solo
   is usually minutes away from it — Autumn Leaves opens at 1.1s and Cannonball
   comes in at 158. So the harder levels cannot reuse that file; they need
   their own cut, taken from soloAt, and this is what makes them.

   Records without a soloAt are skipped and named at the end. They stay
   playable — a level that wants the solo entry falls back to the head clip —
   they are just easier than they are meant to be.
   ------------------------------------------------------------------ */

import { checkTools, extractClip, readLibrary, writeLibrary, formatTimecode } from "./extract.mjs";

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const force = args.includes("--force");

await checkTools();

const library = await readLibrary();
const targets = library.solos.filter((solo) => {
  if (only && solo.id !== only) return false;
  if (solo.soloAt === undefined) return false;
  return force || !solo.soloClip;
});

const missing = library.solos.filter((solo) => solo.soloAt === undefined);

if (targets.length === 0) {
  console.log("Nothing to cut.");
} else {
  console.log(`Cutting ${targets.length} solo clip${targets.length === 1 ? "" : "s"}.\n`);
}

for (const solo of targets) {
  process.stdout.write(`${solo.artist} — ${solo.song} @ ${formatTimecode(solo.soloAt)}\n`);
  try {
    const clip = await extractClip({
      youtubeId: solo.youtubeId,
      soloStart: solo.soloAt,
      // A suffix rather than a directory, so one flat folder still holds
      // every clip and the filename says which cut it is.
      outputId: `${solo.id}--solo`,
      onProgress: (step) => process.stdout.write(`  ${step}\n`),
    });

    solo.soloClip = {
      audio: clip.audio,
      start: clip.soloStart,
      leadIn: clip.leadIn,
      clipDuration: clip.clipDuration,
    };

    // The same silence check the head clips get: a marker that lands in a
    // gap means the timestamp is wrong, not that the solo is quiet.
    if (clip.markerLevel !== null && clip.markerLevel < -45) {
      console.log(`  ⚠ silent at the marker (${clip.markerLevel} dBFS) — check soloAt`);
    }

    // Written as we go, so an interrupted run keeps what it has cut.
    await writeLibrary(library);
    console.log("  done\n");
  } catch (error) {
    console.log(`  failed: ${error.message}\n`);
  }
}

if (missing.length > 0) {
  console.log(`${missing.length} record(s) have no soloAt and were skipped:`);
  for (const solo of missing) console.log(`  ${solo.id}`);
}
