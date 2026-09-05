#!/usr/bin/env node
/* ------------------------------------------------------------------
   npm run retime -- [--to opening | --to solo]

   Moves every clip in the library to a new starting point and re-cuts it.

     --to opening   the first audible moment of the recording (default)
     --to solo      back to where the solo enters, from each entry's soloAt

   The solo time is never thrown away: moving to the opening records it as
   soloAt first, so the trip back costs nothing but the download.
   ------------------------------------------------------------------ */

import {
  checkTools, extractClip, readLibrary, writeLibrary, looksLikeAnOnset,
  SILENT_DBFS, formatTimecode, AUDIO_DIR,
} from "./extract.mjs";
import path from "node:path";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    args[key] = next && !next.startsWith("--") ? (i++, next) : true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const target = args.to === "solo" ? "solo" : "opening";

  await checkTools();

  const library = await readLibrary();
  if (library.solos.length === 0) {
    console.log("\n  The library is empty. Run npm run seed first.\n");
    return;
  }

  console.log(
    `\n  Re-cutting ${library.solos.length} clips to the ${
      target === "solo" ? "solo entry" : "opening of each recording"
    }.\n`,
  );

  const failed = [];
  const silent = [];

  for (const [i, solo] of library.solos.entries()) {
    const position = `${String(i + 1).padStart(2, " ")}/${library.solos.length}`;
    process.stdout.write(`  ${position}  ${solo.artist} — ${solo.song}  `);

    if (target === "solo" && solo.soloAt === undefined) {
      console.log("no solo time recorded, left alone");
      continue;
    }

    try {
      const clip = await extractClip({
        youtubeId: solo.youtubeId,
        soloStart: target === "solo" ? solo.soloAt : "opening",
        outputId: solo.id,
      });

      // Keep the solo time for the trip back.
      if (target === "opening" && solo.soloAt === undefined) {
        solo.soloAt = solo.soloStart;
      }

      solo.soloStart = clip.soloStart;
      // Recut audio: whatever was separated from the old file is not this one.
      delete solo.stems;
      solo.audio = clip.audio;
      solo.leadIn = clip.leadIn;
      solo.clipDuration = clip.clipDuration;
      solo.verified = target === "opening";

      if (clip.markerLevel !== null && clip.markerLevel < SILENT_DBFS) {
        silent.push(`${solo.artist} — ${solo.song}  (silent at ${formatTimecode(clip.soloStart)})`);
        console.log(`SILENT (${clip.markerLevel} dB)`);
      } else if (
        target === "opening" &&
        !(await looksLikeAnOnset(path.join(AUDIO_DIR, `${solo.id}.mp3`), clip.leadIn))
      ) {
        // Sound at the marker but no step up into it: the cut landed inside
        // the music rather than at the head of it.
        solo.verified = false;
        silent.push(`${solo.artist} — ${solo.song}  (starts mid-music at ${formatTimecode(clip.soloStart)})`);
        console.log(`from ${formatTimecode(clip.soloStart)}  NOT AN OPENING`);
      } else {
        console.log(`ok  from ${formatTimecode(clip.soloStart)}`);
      }

      await writeLibrary(library);
    } catch (error) {
      console.log(`FAILED — ${error.message.split("\n")[0].slice(0, 90)}`);
      failed.push(`${solo.artist} — ${solo.song}`);
    }
  }

  console.log(`\n  ${library.solos.length - failed.length} re-cut, ${failed.length} failed.`);
  if (failed.length) for (const name of failed) console.log(`    ${name}`);
  if (silent.length) {
    console.log("\n  These did not land on the head of the tune. They are marked");
    console.log("  unconfirmed; fix them at /admin:");
    for (const name of silent) console.log(`    ${name}`);
  }
  console.log("");
}

main().catch((error) => {
  console.error(`\n  retime failed: ${error.message}\n`);
  process.exit(1);
});
