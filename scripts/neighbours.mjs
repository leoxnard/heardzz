#!/usr/bin/env node
/* ------------------------------------------------------------------
   Build the neighbour index: who each artist in the lexicon sounds like.

   Why this is a build step and not a lookup.

   The five names on the easy levels used to be drawn at random from the
   whole index, which put a swing cornetist beside a fusion bassist beside
   a free-jazz drummer. Four of those answer themselves — you do not need
   to hear the record to rule them out — so the multiple-choice levels were
   easier than the typing ones by an order of magnitude that had nothing to
   do with listening.

   Neighbours fix that, but they cannot be fetched while somebody plays:
   the game does not touch the network during a round, and the daily has to
   give every player the same five names. So the whole map is resolved once,
   here, and shipped as a plain module the client already has.

   Only names already in the lexicon are kept. A decoy that is not in the
   index is a name the typing field would never suggest, and the two ways
   of asking the same question should not disagree about who exists.

   Usage:  node scripts/neighbours.mjs
   Reads:  LASTFM_API_KEY from .env.local
   Writes: lib/lexicon/neighbours.ts
   ------------------------------------------------------------------ */

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const API = "https://ws.audioscrobbler.com/2.0/";
/** Asked for per artist. Far more than are kept — most fall outside the index. */
const ASK = 60;
/** Kept per artist. Four decoys are needed; the rest is slack for the draw. */
const KEEP = 12;
/** Last.fm tolerates a few a second. This is well under, and the run is one-off. */
const GAP_MS = 120;

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (match) process.env[match[1]] ??= match[2].replace(/^["']|["']$/g, "");
  }
}

const KEY = process.env.LASTFM_API_KEY;
if (!KEY) {
  console.error("LASTFM_API_KEY is not set.");
  process.exit(1);
}

/** The same fold `lib/lexicon/index.ts` uses, so both sides agree on a name. */
function normalize(value) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(the|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/*
 * Read the index out of its own module rather than importing it: this is a
 * plain node script and that file is TypeScript. The list is a flat array of
 * string literals, so the literals are the list.
 */
const source = readFileSync("lib/lexicon/artists.ts", "utf8");
const body = source.slice(
  source.indexOf("export const ARTISTS"),
  source.indexOf("export const ARTIST_ALIASES"),
);
const artists = [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
const inLexicon = new Map(artists.map((name) => [normalize(name), name]));

if (artists.length === 0) {
  console.error("Could not read ARTISTS out of lib/lexicon/artists.ts");
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function similar(name) {
  const url = new URL(API);
  url.searchParams.set("method", "artist.getsimilar");
  url.searchParams.set("artist", name);
  url.searchParams.set("limit", String(ASK));
  url.searchParams.set("api_key", KEY);
  url.searchParams.set("format", "json");

  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) return [];
  const data = await response.json().catch(() => null);
  return (data?.similarartists?.artist ?? []).map((a) => String(a?.name ?? "").trim());
}

const map = {};
let thin = 0;

for (const [index, name] of artists.entries()) {
  let found = [];
  try {
    found = await similar(name);
  } catch {
    // A name Last.fm has never heard of simply gets no neighbours, and the
    // draw falls back to the index the way it always did.
  }

  const kept = [];
  const seen = new Set([normalize(name)]);
  for (const candidate of found) {
    const key = normalize(candidate);
    if (seen.has(key)) continue;
    // Their spelling, ours. "Coltrane, John" and "John Coltrane" fold the same.
    const ours = inLexicon.get(key);
    if (!ours) continue;
    seen.add(key);
    kept.push(ours);
    if (kept.length >= KEEP) break;
  }

  if (kept.length > 0) map[name] = kept;
  if (kept.length < 4) thin++;

  process.stdout.write(`\r${index + 1}/${artists.length}  ${name.padEnd(28).slice(0, 28)}`);
  await sleep(GAP_MS);
}

const lines = Object.entries(map)
  .map(([name, near]) => `  ${JSON.stringify(name)}: [${near.map((n) => JSON.stringify(n)).join(", ")}],`)
  .join("\n");

const file = `/* ------------------------------------------------------------------
   Who sounds like whom — generated, do not edit by hand.

   Built by \`node scripts/neighbours.mjs\` from Last.fm's artist.getSimilar,
   filtered to names this lexicon already lists. It exists so the five names
   on a multiple-choice round can all be plausible: drawn at random from the
   whole index, four of the five answered themselves without a note being
   played.

   Not every artist has an entry, and an entry can be short. Both cases fall
   back to the index, which is what the draw did before this file existed.
   ------------------------------------------------------------------ */

export const NEIGHBOURS: Record<string, string[]> = {
${lines}
};
`;

writeFileSync("lib/lexicon/neighbours.ts", file);

const sizes = Object.values(map).map((n) => n.length);
const mean = sizes.reduce((a, b) => a + b, 0) / (sizes.length || 1);
console.log(`\n\nwrote lib/lexicon/neighbours.ts`);
console.log(`  ${Object.keys(map).length}/${artists.length} artists have neighbours`);
console.log(`  ${mean.toFixed(1)} on average, ${thin} with fewer than four`);
