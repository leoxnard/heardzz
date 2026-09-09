/* ------------------------------------------------------------------
   What is wrong with the library that a person can fix.

     node scripts/check-library.mjs

   Not a test of the code. Everything here is a fact about the records —
   credits that were never filled in, a bassist the sleeve forgot, the same
   tune entered twice — and every one of them shows up downstream as a
   rhythm section missing an instrument or a round that plays the wrong
   thing. They are invisible in the library screen because each looks fine
   on its own; they are only visible from above.
   ------------------------------------------------------------------ */

import { statSync } from "node:fs";
import path from "node:path";
import { AUDIO_DIR, readLibrary } from "./extract.mjs";
import { RHYTHM_HEADS, leadHeadsFor, rhythmHeadsFor } from "./separate.mjs";

const library = await readLibrary();

const shapeOf = (solo, cut) => ({
  cut, role: solo.soloistRole, personnel: solo.personnel,
  melody: solo.melody, artist: solo.artist,
});

const normalize = (value) =>
  String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/* One row per recording rather than per entry: everything below is about
   the record, and a tune with three soloists would otherwise say it three
   times. */
const recordings = new Map();
for (const solo of library.solos) {
  const group = recordings.get(solo.youtubeId) ?? [];
  group.push(solo);
  recordings.set(solo.youtubeId, group);
}

const report = (title, rows) => {
  if (rows.length === 0) return 0;
  console.log(`\n${title}  (${rows.length})`);
  for (const row of rows) console.log(`  ${row}`);
  return rows.length;
};

let total = 0;

/*
 * No credits at all reads as "every instrument", because `headsInCredits`
 * has no opinion to offer and the alternative — an empty rhythm section —
 * is worse. So the rhythm mix gets a guitar head that has no guitarist
 * behind it, which is bleed, and on these records bleed is the horns.
 */
total += report(
  "No credits. The rhythm section is guessed, and guesses include a guitar that is not there",
  [...recordings.values()]
    .filter(([solo]) => (solo.personnel ?? []).filter((c) => c.role).length === 0)
    .map(([solo]) => `${solo.artist} — ${solo.song}`),
);

/*
 * And credits that exist but leave somebody out. A rhythm section without
 * a bass or without drums is nearly always a sleeve that forgot them
 * rather than a record that had none — and the mix comes out missing a
 * part that is plainly audible in it.
 */
total += report(
  "Credited, but the rhythm section comes out short. Check for a missing name",
  [...recordings.values()]
    .filter(([solo]) => (solo.personnel ?? []).filter((c) => c.role).length > 0)
    .map(([solo]) => ({ solo, heads: rhythmHeadsFor(shapeOf(solo, "head")) }))
    .filter(({ heads }) => !heads.includes("bass") || !heads.includes("drums"))
    .map(({ solo, heads }) =>
      `${solo.artist} — ${solo.song}`.padEnd(44) +
      `rhythm ${heads.join("+") || "—"}`),
);

/*
 * The same tune twice. Usually one of them was added from a link whose
 * uploader ended up in the artist field, so the pair does not group in the
 * list and both stay in the pool answering to different names.
 */
const byTune = new Map();
for (const [, group] of recordings) {
  const solo = group[0];
  const names = [normalize(solo.artist), normalize(solo.song)].sort().join(" / ");
  byTune.set(names, [...(byTune.get(names) ?? []), solo]);
}
total += report(
  "The same tune more than once",
  [...byTune.values()]
    .filter((group) => group.length > 1)
    .map((group) => group.map((solo) => `${solo.artist} — ${solo.song}`).join("   |   ")),
);

/*
 * A rhythm instrument named as the melody. Legitimate — Moanin' opens on
 * Bobby Timmons alone, and a piano trio has nothing else to state a theme
 * — but it takes that instrument out of the rhythm section for the head
 * cut, so it is worth seeing rather than discovering.
 */
total += report(
  "The theme is on a rhythm instrument, so the rhythm section plays without it",
  [...recordings.values()]
    .map(([solo]) => ({ solo, lead: leadHeadsFor(shapeOf(solo, "head")) }))
    .filter(({ lead }) => lead.some((head) => RHYTHM_HEADS.includes(head)))
    .map(({ solo, lead }) =>
      `${solo.artist} — ${solo.song}`.padEnd(44) +
      `lead ${lead.join("+")}`.padEnd(16) +
      `rhythm ${rhythmHeadsFor(shapeOf(solo, "head")).join("+") || "—"}`),
);

/*
 * Stems older than the clip they were lifted out of.
 *
 * A record marked again keeps its id, so the clip is written over the old
 * one — same filename, different music — and until this was fixed the stems
 * of the previous cut stayed on disk and stayed on any sibling entry that
 * was not itself re-marked. Nothing downstream can tell: the names still
 * resolve, the levels still measure fine, and the only symptom is that the
 * soloist layer and the full mix are two different moments of the tune.
 *
 * The clock settles it. A stem is always written after the clip it came
 * from, so a stem file older than its clip belongs to a cut that is gone.
 */
const olderThanItsClip = [];
for (const [, group] of recordings) {
  for (const solo of group) {
    const cuts = [
      { label: "opening", audio: solo.audio, stems: solo.stems },
      { label: "solo", audio: solo.soloClip?.audio, stems: solo.soloClip?.stems },
    ];
    for (const cut of cuts) {
      if (!cut.audio || !cut.stems) continue;
      const clip = statSync(path.join(AUDIO_DIR, path.basename(cut.audio)), {
        throwIfNoEntry: false,
      });
      if (!clip) continue;
      const behind = Object.entries(cut.stems)
        .map(([id, variant]) => ({
          id,
          file: statSync(path.join(AUDIO_DIR, path.basename(variant.audio)), {
            throwIfNoEntry: false,
          }),
        }))
        // A second of slack: one split writes the clip's stems in a burst.
        .filter(({ file }) => file && file.mtimeMs < clip.mtimeMs - 1000)
        .map(({ id }) => id);
      if (behind.length > 0) {
        olderThanItsClip.push(
          `${solo.artist} — ${solo.song}`.padEnd(44) +
            `${cut.label} · ${behind.join(", ")}`,
        );
      }
    }
  }
}
total += report(
  "Stems older than the clip they came from. Split these again",
  olderThanItsClip,
);

console.log(
  total === 0
    ? "\nNothing to fix."
    : `\n${total} thing(s) to look at across ${recordings.size} recording(s).`,
);
