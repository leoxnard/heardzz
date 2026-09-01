#!/usr/bin/env node
/* ------------------------------------------------------------------
   npm run add-track -- --search "..." --soloist "..." --song "..." --solo 3:26

   Resolves the source, cuts the clip, and writes the entry into
   data/solos.json. The timestamp is recorded as unverified: the admin
   screen is where a human confirms it against the waveform.
   ------------------------------------------------------------------ */

import {
  checkTools, resolveSource, extractClip, readLibrary, upsertSolo,
  nextCatalog, parseTimecode, formatTimecode, slugify, SILENT_DBFS,
} from "./extract.mjs";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

const USAGE = `
  add-track — pull one solo into the library

  Required
    --artist   <name>        who the record is by  (answer one)
    --song     <title>       the tune              (answer two)
    --solo     <mm:ss>       where the solo enters in the source
    --search   <phrase>      what to look for on YouTube
      or
    --url      <url>         an exact video

  Optional
    --soloist  <name>        who takes this solo; shown on reveal
    --album    <title>
    --year     <yyyy>
    --label    <name>
    --note     <text>        one line shown on reveal
    --id       <slug>        default: derived from song and soloist
    --verified               mark the timestamp as already checked
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || (!args.artist && !args.song)) {
    console.log(USAGE);
    process.exit(args.help ? 0 : 1);
  }

  const missing = ["artist", "song", "solo"].filter((k) => !args[k]);
  if (!args.search && !args.url) missing.push("search or url");
  if (missing.length) {
    console.error(`\n  Missing: ${missing.join(", ")}\n${USAGE}`);
    process.exit(1);
  }

  await checkTools();

  const soloStart = parseTimecode(args.solo);
  const id = args.id || slugify(`${args.song}-${args.artist}`);

  process.stdout.write(`  ${args.artist} — ${args.song} @ ${formatTimecode(soloStart)}\n`);
  process.stdout.write(`  resolving source… `);

  const source = await resolveSource(args.url || args.search);
  process.stdout.write(`${source.title} [${source.youtubeId}]\n`);

  if (source.duration && soloStart > source.duration) {
    throw new Error(
      `Solo at ${formatTimecode(soloStart)} is past the end of a ` +
        `${formatTimecode(source.duration)} recording`,
    );
  }

  const clip = await extractClip({
    youtubeId: source.youtubeId,
    soloStart,
    outputId: id,
    onProgress: (msg) => process.stdout.write(`  ${msg}…\n`),
  });

  const library = await readLibrary();

  await upsertSolo({
    id,
    catalog: library.solos.find((s) => s.id === id)?.catalog ?? nextCatalog(library),
    artist: args.artist,
    song: args.song,
    soloist: args.soloist || args.artist,
    album: args.album || "",
    year: Number(args.year) || 0,
    label: args.label || "",
    youtubeId: source.youtubeId,
    soloStart,
    audio: clip.audio,
    leadIn: clip.leadIn,
    clipDuration: clip.clipDuration,
    verified: Boolean(args.verified),
    note: typeof args.note === "string" ? args.note : undefined,
  });

  console.log(`  written  public${clip.audio}  (${clip.clipDuration}s, lead-in ${clip.leadIn}s)`);

  if (clip.markerLevel !== null && clip.markerLevel < SILENT_DBFS) {
    console.log(
      `  WARNING  the clip is silent where the round starts (${clip.markerLevel} dB). ` +
        `The time is wrong, or the upload opens with a gap.`,
    );
  }
  console.log(`  ${args.verified ? "verified" : "unverified — confirm it at /admin"}\n`);
}

main().catch((error) => {
  console.error(`\n  failed: ${error.message}\n`);
  process.exit(1);
});
