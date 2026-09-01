#!/usr/bin/env node
/* ------------------------------------------------------------------
   npm run add-track -- --search "..." --artist "..." --song "..." [--solo 3:26]

   Resolves the source, cuts the clip, and writes the entry into
   data/solos.json.

   Without --solo the round starts at the first audible moment of the
   upload, which is what the web import and the suggestion queue both do —
   dead air, needle drop and encoder padding are found and skipped rather
   than counted as the opening. Give --solo only to cut from somewhere else.
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
    --search   <phrase>      what to look for on YouTube
      or
    --url      <url>         an exact video

  Optional
    --solo     <mm:ss>       where to cut from; default: the first audible moment
    --album    <title>
    --year     <yyyy>
    --note     <text>        one line shown on reveal
    --id       <slug>        default: derived from song and artist
    --verified               mark the timestamp as already checked
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || (!args.artist && !args.song)) {
    console.log(USAGE);
    process.exit(args.help ? 0 : 1);
  }

  const missing = ["artist", "song"].filter((k) => !args[k]);
  if (!args.search && !args.url) missing.push("search or url");
  if (missing.length) {
    console.error(`\n  Missing: ${missing.join(", ")}\n${USAGE}`);
    process.exit(1);
  }

  await checkTools();

  // "opening" is resolved against the audio once it is downloaded, so
  // finding the downbeat costs nothing extra.
  const wantsOpening = args.solo === undefined;
  const soloStart = wantsOpening ? "opening" : parseTimecode(args.solo);
  const id = args.id || slugify(`${args.song}-${args.artist}`);

  process.stdout.write(
    `  ${args.artist} — ${args.song} @ ${wantsOpening ? "the opening" : formatTimecode(soloStart)}\n`,
  );
  process.stdout.write(`  resolving source… `);

  const source = await resolveSource(args.url || args.search);
  process.stdout.write(`${source.title} [${source.youtubeId}]\n`);

  if (source.duration && !wantsOpening && soloStart > source.duration) {
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
    album: args.album || "",
    year: Number(args.year) || 0,
    personnel: [],
    soloist: args.soloist || args.artist,
    youtubeId: source.youtubeId,
    // What the extractor actually settled on, which for "opening" is the
    // detected downbeat rather than the string.
    soloStart: clip.soloStart,
    audio: clip.audio,
    leadIn: clip.leadIn,
    clipDuration: clip.clipDuration,
    verified: Boolean(args.verified),
    note: typeof args.note === "string" ? args.note : undefined,
  });

  console.log(
    `  written  ${clip.audio}  ` +
      `(from ${formatTimecode(clip.soloStart)}, ${clip.clipDuration}s, lead-in ${clip.leadIn}s)`,
  );

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
