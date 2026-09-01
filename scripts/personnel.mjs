#!/usr/bin/env node
/* ------------------------------------------------------------------
   npm run personnel [-- --force]

   Fills in who played on each record, from Discogs.

   Entries that already have credits are left alone unless --force is
   given. Discogs credits a release rather than a session, so a
   compilation hands back everyone who ever played on it; those are
   flagged rather than quietly presented as a line-up.
   ------------------------------------------------------------------ */

import { lookupByTrack, lookupPersonnel } from "./discogs.mjs";
import { readLibrary, writeLibrary } from "./extract.mjs";

async function main() {
  const force = process.argv.includes("--force");
  const library = await readLibrary();

  if (library.solos.length === 0) {
    console.log("\n  The library is empty. Run npm run seed first.\n");
    return;
  }

  console.log(`\n  Looking up ${library.solos.length} records on Discogs.\n`);

  const suspect = [];
  const missing = [];

  for (const [i, solo] of library.solos.entries()) {
    const position = `${String(i + 1).padStart(2, " ")}/${library.solos.length}`;
    process.stdout.write(`  ${position}  ${solo.artist} — ${solo.song}  `);

    if (!force && Array.isArray(solo.personnel) && solo.personnel.length > 0) {
      console.log(`already has ${solo.personnel.length}, skipped`);
      continue;
    }

    try {
      /*
       * The album field is curated, so it goes first: searching by tune alone
       * finds the earliest record carrying a tune of that name, which for
       * "Waltz For Debby" is a 1956 solo piano date rather than the 1961 trio
       * everyone means. The tune search is the fallback, and it takes over
       * when the album turns out to be an anthology whose credits list every
       * musician across every session on it.
       */
      let found = null;

      if (solo.album) {
        const byAlbum = await lookupPersonnel(solo.artist, solo.album, solo.song);
        if (byAlbum.release && byAlbum.personnel.length > 0) {
          found = { ...byAlbum.release, personnel: byAlbum.personnel, suspect: byAlbum.suspect };
        }
      }

      // One name is a release nobody credited, not a solo record.
      if (!found || found.suspect || found.personnel.length < 3) {
        const byTrack = await lookupByTrack(solo.artist, solo.song);
        // Only take the tune's answer if it is cleaner than the album's.
        if (byTrack && byTrack.personnel.length > 0 && (!found || !byTrack.suspect)) {
          found = byTrack;
        }
      }

      if (!found || found.personnel.length === 0) {
        console.log("nothing found");
        missing.push(`${solo.artist} — ${solo.song}`);
        continue;
      }

      solo.personnel = found.personnel;
      solo.discogsReleaseId = found.id;
      await writeLibrary(library);

      console.log(
        `${found.personnel.length} credits  ${found.title}${found.suspect ? "  STILL LOOKS LIKE A COMPILATION" : ""}`,
      );
      if (found.suspect) suspect.push(`${solo.artist} — ${solo.song}`);
    } catch (error) {
      console.log(`FAILED — ${error.message}`);
      missing.push(`${solo.artist} — ${solo.song}`);
    }
  }

  if (suspect.length) {
    console.log("\n  These read as compilation credits rather than one session's band.");
    console.log("  Discogs cannot tell them apart; trim them by hand at /admin:");
    for (const name of suspect) console.log(`    ${name}`);
  }

  if (missing.length) {
    console.log("\n  No credits found for:");
    for (const name of missing) console.log(`    ${name}`);
  }

  console.log("");
}

main().catch((error) => {
  console.error(`\n  personnel failed: ${error.message}\n`);
  process.exit(1);
});
