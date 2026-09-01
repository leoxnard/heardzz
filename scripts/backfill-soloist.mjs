/* ------------------------------------------------------------------
   Fill in who is actually playing.

     node scripts/backfill-soloist.mjs [--write]

   The soloist was never a field, but it was never lost either: every id in
   the library was minted as <tune>-<soloist>, which is why "Moanin'" is
   filed as moanin-lee-morgan while the sleeve — and the artist field — says
   Art Blakey. So the name is recovered by matching the tail of the id
   against the credits, which also settles the spelling and hands over the
   instrument for free.

   Anything that will not resolve is printed and left alone rather than
   guessed at; the leader is the fallback, and a wrong fallback is a
   question with a wrong answer behind it.
   ------------------------------------------------------------------ */

import { readLibrary, writeLibrary, slugify } from "./extract.mjs";

const write = process.argv.includes("--write");

const library = await readLibrary();
const unresolved = [];
let changed = 0;

for (const solo of library.solos) {
  const credit = solo.personnel.find((entry) => solo.id.endsWith(`-${slugify(entry.name)}`));
  const soloist = credit?.name ?? solo.artist;
  const role = credit?.role || undefined;

  if (!credit) unresolved.push(solo);
  if (solo.soloist === soloist && solo.soloistRole === role) continue;

  solo.soloist = soloist;
  if (role) solo.soloistRole = role;
  else delete solo.soloistRole;
  changed += 1;

  const flag = credit ? (soloist === solo.artist ? "  " : "→ ") : "? ";
  console.log(
    `${flag}${solo.id.padEnd(34)} ${soloist}${role ? `  (${role})` : ""}`,
  );
}

console.log(`\n${changed} of ${library.solos.length} updated.`);

if (unresolved.length > 0) {
  console.log(
    `\n${unresolved.length} could not be matched against the credits and fell back to the leader:`,
  );
  for (const solo of unresolved) console.log(`  ${solo.id}  → ${solo.artist}`);
}

if (write) {
  await writeLibrary(library);
  console.log("\nWritten.");
} else {
  console.log("\nDry run. Pass --write to save.");
}
