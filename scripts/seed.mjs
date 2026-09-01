#!/usr/bin/env node
/* ------------------------------------------------------------------
   The starting library.

   Chosen for unambiguous attribution and spread across era — early jazz
   through hard bop to the second quintet.

   Rounds open at the top of each recording, so the cut point is found by
   ear-free onset detection rather than taken on trust. The `solo` time on
   each entry is kept as soloAt: it is what `npm run retime -- --to solo`
   would cut from, and it is an estimate, not a checked fact.

   Failures are collected rather than thrown, so one dead video does not
   cost you the other eighteen.
   ------------------------------------------------------------------ */

import {
  checkTools, resolveSource, extractClip, readLibrary, upsertSolo,
  nextCatalog, formatTimecode, slugify, SILENT_DBFS,
} from "./extract.mjs";

/*
 * Second soloists on takes that are already here — Max Roach on St. Thomas,
 * Curtis Fuller on Blue Train, Coltrane and Cannonball on So What — were
 * dropped when rounds moved to the top of each recording: they would be the
 * same clip with the same answer. They are worth restoring the day rounds cut
 * at the solo instead.
 */
const SEED = [
  {
    artist: "Louis Armstrong", song: "West End Blues",
    soloist: "Louis Armstrong", album: "The Hot Fives & Hot Sevens",
    year: 1928, label: "OKeh", solo: 5.2,
    search: "Louis Armstrong West End Blues 1928 Hot Five",
    note: "The unaccompanied opening cadenza — twelve seconds that reset what a jazz solo could be.",
  },
  {
    artist: "Charlie Parker", song: "Ko Ko",
    soloist: "Charlie Parker", album: "The Savoy Recordings",
    year: 1945, label: "Savoy", solo: 26,
    search: "Charlie Parker Ko Ko 1945 Savoy",
    note: "Cherokee's changes at a tempo nobody had taken them before.",
  },
  {
    artist: "Clifford Brown", song: "Joy Spring",
    soloist: "Clifford Brown", album: "Clifford Brown and Max Roach",
    year: 1954, label: "EmArcy", solo: 47,
    search: "Clifford Brown Joy Spring Clifford Brown and Max Roach",
  },
  {
    artist: "Sonny Rollins", song: "St. Thomas",
    soloist: "Sonny Rollins", album: "Saxophone Colossus",
    year: 1956, label: "Prestige", solo: 50,
    search: "Sonny Rollins St Thomas Saxophone Colossus",
  },
  {
    artist: "John Coltrane", song: "Blue Train",
    soloist: "John Coltrane", album: "Blue Train",
    year: 1957, label: "Blue Note", solo: 62,
    search: "John Coltrane Blue Train full track Blue Note",
  },
  {
    artist: "Cannonball Adderley", song: "Autumn Leaves",
    soloist: "Cannonball Adderley", album: "Somethin' Else",
    year: 1958, label: "Blue Note", solo: 158,
    search: "Cannonball Adderley Autumn Leaves Somethin Else",
  },
  {
    artist: "Art Blakey", song: "Moanin'",
    soloist: "Lee Morgan", album: "Moanin'",
    year: 1958, label: "Blue Note", solo: 95,
    search: "Art Blakey Jazz Messengers Moanin 1958 full",
  },
  {
    artist: "Miles Davis", song: "Freddie Freeloader",
    soloist: "Wynton Kelly", album: "Kind Of Blue",
    year: 1959, label: "Columbia", solo: 30,
    search: "Miles Davis Freddie Freeloader Kind of Blue",
    note: "The one track on Kind Of Blue where Kelly, not Evans, takes the chair.",
  },
  {
    artist: "Miles Davis", song: "So What",
    soloist: "Miles Davis", album: "Kind Of Blue",
    year: 1959, label: "Columbia", solo: 92,
    search: "Miles Davis So What Kind of Blue",
  },
  {
    artist: "John Coltrane", song: "Giant Steps",
    soloist: "John Coltrane", album: "Giant Steps",
    year: 1960, label: "Atlantic", solo: 10,
    search: "John Coltrane Giant Steps 1960 Atlantic",
    note: "Sixteen bars in and already three tonal centres deep.",
  },
  {
    artist: "Wes Montgomery", song: "Four On Six",
    soloist: "Wes Montgomery", album: "The Incredible Jazz Guitar",
    year: 1960, label: "Riverside", solo: 47,
    search: "Wes Montgomery Four on Six Incredible Jazz Guitar",
  },
  {
    artist: "Bill Evans", song: "Gloria's Step",
    soloist: "Scott LaFaro", album: "Sunday At The Village Vanguard",
    year: 1961, label: "Riverside", solo: 130,
    search: "Bill Evans Trio Gloria's Step Sunday at the Village Vanguard",
    note: "Recorded eleven days before LaFaro died at twenty-five.",
  },
  {
    artist: "Bill Evans", song: "Waltz For Debby",
    soloist: "Bill Evans", album: "Waltz For Debby",
    year: 1961, label: "Riverside", solo: 82,
    search: "Bill Evans Waltz for Debby Village Vanguard 1961",
  },
  {
    artist: "Dexter Gordon", song: "Cheese Cake",
    soloist: "Dexter Gordon", album: "Go",
    year: 1962, label: "Blue Note", solo: 52,
    search: "Dexter Gordon Cheese Cake Go 1962",
  },
  {
    artist: "Miles Davis", song: "Footprints",
    soloist: "Wayne Shorter", album: "Miles Smiles",
    year: 1966, label: "Columbia", solo: 84,
    search: "Miles Davis Footprints Miles Smiles 1966",
  },
  {
    artist: "Herbie Hancock", song: "Cantaloupe Island",
    soloist: "Herbie Hancock", album: "Empyrean Isles",
    year: 1964, label: "Blue Note", solo: 108,
    search: "Herbie Hancock Cantaloupe Island Empyrean Isles",
  },
];

async function main() {
  await checkTools();

  console.log(`\n  Seeding ${SEED.length} solos. This pulls audio from YouTube one at a time.\n`);

  const done = [];
  const failed = [];
  const silentAtMarker = [];

  for (const [i, entry] of SEED.entries()) {
    const id = entry.id || slugify(`${entry.song}-${entry.artist}`);
    const position = `${String(i + 1).padStart(2, " ")}/${SEED.length}`;

    process.stdout.write(`  ${position}  ${entry.artist} — ${entry.song}  `);

    try {
      const library = await readLibrary();
      if (library.solos.some((s) => s.id === id)) {
        console.log("already present, skipped");
        done.push(id);
        continue;
      }

      const source = await resolveSource(entry.search);
      const clip = await extractClip({
        youtubeId: source.youtubeId,
        soloStart: "opening",
        outputId: id,
      });

      await upsertSolo({
        id,
        catalog: nextCatalog(library),
        artist: entry.artist,
        song: entry.song,
        soloist: entry.soloist,
        album: entry.album,
        year: entry.year,
        label: entry.label,
        youtubeId: source.youtubeId,
        soloStart: clip.soloStart,
        soloAt: entry.solo,
        audio: clip.audio,
        leadIn: clip.leadIn,
        clipDuration: clip.clipDuration,
        verified: true,
        note: entry.note,
      });

      const silent = clip.markerLevel !== null && clip.markerLevel < SILENT_DBFS;
      console.log(
        silent
          ? `ok  from ${formatTimecode(clip.soloStart)}  SILENT (${clip.markerLevel} dB)`
          : `ok  from ${formatTimecode(clip.soloStart)}`,
      );
      if (silent) silentAtMarker.push(`${entry.artist} — ${entry.song}`);
      done.push(id);
    } catch (error) {
      console.log(`FAILED — ${error.message.split("\n")[0]}`);
      failed.push({ id, entry, reason: error.message.split("\n")[0] });
    }
  }

  console.log(`\n  ${done.length} in the library, ${failed.length} failed.`);
  if (failed.length) {
    console.log("\n  Failed entries:");
    for (const f of failed) console.log(`    ${f.entry.artist} — ${f.entry.song}: ${f.reason}`);
    console.log("\n  Retry individually with npm run add-track, or add them at /admin.");
  }
  if (silentAtMarker.length) {
    console.log("\n  Silent where the round would start — these timestamps are wrong,");
    console.log("  not merely unconfirmed. Fix them first at /admin:");
    for (const name of silentAtMarker) console.log(`    ${name}`);
  }

  console.log(
    "\n  Rounds open at the first audible moment of each recording, found by " +
      "onset\n  detection. Switch to solo entries with: npm run retime -- --to solo\n",
  );
}

main().catch((error) => {
  console.error(`\n  seed failed: ${error.message}\n`);
  process.exit(1);
});
