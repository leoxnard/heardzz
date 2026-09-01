#!/usr/bin/env node
/* ------------------------------------------------------------------
   npm run fetch-missing

   Downloads and cuts every clip file the library refers to but which is not
   on disk. The library file travels with the repository; the audio does not,
   so this is what turns a fresh checkout — or a fresh server volume — into
   something you can actually listen to.

   Counted and fetched by file rather than by entry: a record with three
   soloists shares one head clip across three ids, so that clip is one thing
   to fetch, not three, and cutting it once settles every entry that names it.

   Safe to run repeatedly: clips already present are left alone.
   ------------------------------------------------------------------ */

import {
  applyClipToLibrary, checkTools, extractClip, missingAudioTargets,
  readLibrary, DATA_DIR, SILENT_DBFS, formatTimecode,
} from "./extract.mjs";

async function main() {
  await checkTools();

  const library = await readLibrary();
  if (library.solos.length === 0) {
    console.log("\n  The library is empty. Run npm run seed instead.\n");
    return;
  }

  const missing = missingAudioTargets(library.solos);

  console.log(`\n  Library: ${library.solos.length} records in ${DATA_DIR}`);

  if (missing.length === 0) {
    console.log("  Every clip is already on disk.\n");
    return;
  }

  console.log(`  Missing ${missing.length} clip file(s). Fetching.\n`);

  const failed = [];

  for (const [i, target] of missing.entries()) {
    const position = `${String(i + 1).padStart(2, " ")}/${missing.length}`;
    const named = library.solos.find((solo) => solo.youtubeId === target.youtubeId);
    const label = named ? `${named.artist} — ${named.song}` : target.outputId;
    process.stdout.write(`  ${position}  ${label}  `);

    try {
      const clip = await extractClip({
        youtubeId: target.youtubeId,
        // Rebuild at the point the entry already records, not by guessing again.
        soloStart: target.start,
        outputId: target.outputId,
      });
      const touched = await applyClipToLibrary(target.outputId, clip);

      const quiet = clip.markerLevel !== null && clip.markerLevel < SILENT_DBFS;
      const shared = touched > 1 ? `, shared by ${touched} entries` : "";
      console.log(`ok  from ${formatTimecode(clip.soloStart)}${quiet ? "  SILENT" : ""}${shared}`);
    } catch (error) {
      console.log(`FAILED — ${error.message.split("\n")[0].slice(0, 80)}`);
      failed.push(label);
    }
  }

  console.log(`\n  ${missing.length - failed.length} fetched, ${failed.length} failed.`);
  if (failed.length) for (const name of failed) console.log(`    ${name}`);
  console.log("");
}

main().catch((error) => {
  console.error(`\n  fetch-missing failed: ${error.message}\n`);
  process.exit(1);
});
