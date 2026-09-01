#!/usr/bin/env node
/* ------------------------------------------------------------------
   npm run fetch-missing

   Downloads and cuts every clip the library refers to but which is not on
   disk. The library file travels with the repository; the audio does not,
   so this is what turns a fresh checkout — or a fresh server volume — into
   something you can actually listen to.

   Safe to run repeatedly: clips already present are left alone.
   ------------------------------------------------------------------ */

import { existsSync } from "node:fs";
import path from "node:path";
import {
  checkTools, extractClip, readLibrary, writeLibrary,
  AUDIO_DIR, DATA_DIR, SILENT_DBFS, formatTimecode,
} from "./extract.mjs";

async function main() {
  await checkTools();

  const library = await readLibrary();
  if (library.solos.length === 0) {
    console.log("\n  The library is empty. Run npm run seed instead.\n");
    return;
  }

  const missing = library.solos.filter(
    (solo) => !existsSync(path.join(AUDIO_DIR, `${solo.id}.mp3`)),
  );

  console.log(`\n  Library: ${library.solos.length} records in ${DATA_DIR}`);

  if (missing.length === 0) {
    console.log("  Every clip is already on disk.\n");
    return;
  }

  console.log(`  Missing ${missing.length}. Fetching.\n`);

  const failed = [];

  for (const [i, solo] of missing.entries()) {
    const position = `${String(i + 1).padStart(2, " ")}/${missing.length}`;
    process.stdout.write(`  ${position}  ${solo.artist} — ${solo.song}  `);

    try {
      const clip = await extractClip({
        youtubeId: solo.youtubeId,
        // Rebuild at the point the entry already records, not by guessing again.
        soloStart: solo.soloStart ?? "opening",
        outputId: solo.id,
      });

      solo.audio = clip.audio;
      solo.leadIn = clip.leadIn;
      solo.clipDuration = clip.clipDuration;
      solo.sourceDuration = clip.sourceDuration;
      await writeLibrary(library);

      const quiet = clip.markerLevel !== null && clip.markerLevel < SILENT_DBFS;
      console.log(`ok  from ${formatTimecode(clip.soloStart)}${quiet ? "  SILENT" : ""}`);
    } catch (error) {
      console.log(`FAILED — ${error.message.split("\n")[0].slice(0, 80)}`);
      failed.push(`${solo.artist} — ${solo.song}`);
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
