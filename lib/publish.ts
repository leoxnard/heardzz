import { unlink } from "node:fs/promises";
import path from "node:path";
import {
  cutFromSource, dropSource, nextCatalog, readLibrary, slugify, writeLibrary,
} from "@/scripts/extract.mjs";
import { stemFilesFor } from "@/scripts/separate.mjs";
import { cleanName } from "./clean";
import { findDuplicates } from "./duplicates";
import { ARTISTS, SONGS, canonical } from "./lexicon";
import { AUDIO_DIR } from "./paths";
import { resolveSoloist } from "./soloist";
import type { Credit, MarkedSolo, Solo } from "./types";

/* ------------------------------------------------------------------
   Turning a marked-up recording into library entries.

   Everything up to here happened against the whole tune, on disk. This is
   the moment it becomes clips: one for the head, one per solo, all cut
   locally out of the file that is already there — and then the recording is
   thrown away.

   Lifted out of the publish route because there are two ways in now. One is
   a person at the marking screen. The other is a playlist being fetched
   without one, where every record gets its opening cut, no solos at all,
   and lands unverified for somebody to listen to later. Both want exactly
   this, so there is one of it.
   ------------------------------------------------------------------ */

export interface PublishInput {
  youtubeId: string;
  artist: string;
  song: string;
  album?: string;
  year?: number;
  note?: string;
  personnel?: Credit[];
  discogsReleaseId?: number;
  /** Carried through when the record was found via TIDAL rather than pasted. */
  isrc?: string;
  tidalArtistId?: string;
  /** Where the tune itself begins. "opening" finds the first sound instead. */
  start: number | "opening";
  solos: MarkedSolo[];
  /** Entries this replaces — anything not re-marked is dropped. */
  replaces?: string[];
  /** Keep the recording on disk, for a session that is not finished with it. */
  keepSource?: boolean;
  /**
   * Whether a person has confirmed the start point. True from the marking
   * screen, where somebody looked at the waveform; false from an automatic
   * fetch, where nobody has heard it yet.
   */
  verified?: boolean;
}

export interface PublishOutcome {
  solos: Solo[];
  removed: string[];
}

/** Thrown rather than returned: every caller has to refuse, not carry on. */
export class DuplicateRecord extends Error {
  readonly duplicates: string[];

  constructor(message: string, duplicates: string[]) {
    super(message);
    this.name = "DuplicateRecord";
    this.duplicates = duplicates;
  }
}

/** Filenames are slugs; the stored path is a URL. Read one off the other. */
function clipFile(audio: string): string {
  return path.join(AUDIO_DIR, path.basename(audio));
}

export async function publishRecord(body: PublishInput): Promise<PublishOutcome> {
  // Brackets and stray spaces are stripped here rather than at the form, so
  // a name reaches the library in one shape whichever door it came through —
  // and where the lexicon already spells the name, that spelling wins.
  const artist = canonical(cleanName(body.artist), ARTISTS);
  const song = canonical(cleanName(body.song), SONGS);
  const personnel = Array.isArray(body.personnel) ? body.personnel : [];
  const base = slugify(`${song}-${artist}`);
  const marks: MarkedSolo[] = Array.isArray(body.solos) ? body.solos : [];

  const library = await readLibrary();
  const solos = library.solos as Solo[];
  const replaces = new Set(body.replaces ?? []);

  // Adding the same record twice leaves two entries that answer the same
  // question with two different clips, and nothing downstream can tell them
  // apart. Re-marking one is not that: it names what it replaces.
  const clashes = findDuplicates(solos, { youtubeId: body.youtubeId, artist, song })
    .filter((solo) => !replaces.has(solo.id));
  if (clashes.length > 0) {
    const [first] = clashes;
    throw new DuplicateRecord(
      `"${first.song}" by ${first.artist} is already in the library ` +
        `(${clashes.map((solo) => solo.catalog).join(", ")}). ` +
        `Open it and mark it again rather than adding it twice.`,
      clashes.map((solo) => solo.id),
    );
  }

  // The head is one clip however many people solo on the record, so it is
  // cut once and every entry points at the same file.
  const head = await cutFromSource({
    youtubeId: body.youtubeId,
    start: body.start === "opening" ? "opening" : Math.max(0, body.start),
    outputId: base,
  });

  // An entry per solo — and, when nobody solos, one for the tune itself, so
  // a record can be added in the time it takes to find the downbeat.
  const wanted: MarkedSolo[] = marks.length > 0
    ? marks
    : [{ at: head.soloStart, soloist: artist }];

  const taken = new Set(
    solos.filter((solo) => !replaces.has(solo.id)).map((solo) => solo.id),
  );
  const written: Solo[] = [];
  let catalogPool = { ...library, solos: [...solos] };

  for (const [index, mark] of wanted.entries()) {
    const soloist = resolveSoloist(mark.soloist, artist, personnel);

    let id = mark.id ?? (index === 0
      ? base
      : `${base}-${slugify(soloist.soloist) || String(index + 1)}`);
    // Two tenor players called the same thing is not a case worth naming.
    for (let n = 2; taken.has(id) && !replaces.has(id); n++) id = `${base}-${n}`;
    taken.add(id);

    const hasSolo = marks.length > 0;
    const soloClip = hasSolo
      ? await cutFromSource({
          youtubeId: body.youtubeId,
          start: Math.max(0, mark.at),
          outputId: `${id}--solo`,
        })
      : null;

    const existing = solos.find((solo) => solo.id === id);

    const solo: Solo = {
      id,
      catalog: existing?.catalog ?? nextCatalog(catalogPool),
      artist,
      song,
      album: cleanName(body.album) || existing?.album || "",
      year: Number(body.year) || existing?.year || 0,
      personnel,
      ...soloist,
      discogsReleaseId: body.discogsReleaseId,
      isrc: body.isrc || existing?.isrc,
      tidalArtistId: body.tidalArtistId || existing?.tidalArtistId,
      youtubeId: body.youtubeId,
      soloStart: head.soloStart,
      audio: head.audio,
      leadIn: head.leadIn,
      clipDuration: head.clipDuration,
      sourceDuration: head.sourceDuration,
      soloAt: soloClip ? soloClip.soloStart : undefined,
      soloClip: soloClip
        ? {
            audio: soloClip.audio,
            start: soloClip.soloStart,
            leadIn: soloClip.leadIn,
            clipDuration: soloClip.clipDuration,
          }
        : undefined,
      /*
       * True from the marking screen: both markers were put there by a
       * person looking at the waveform. False when a playlist was fetched
       * automatically — the onset detector placed the start and nobody has
       * heard it, which is exactly what the unverified list is for.
       */
      verified: body.verified ?? true,
      note: mark.note?.trim() || body.note?.trim() || undefined,
    };

    written.push(solo);
    catalogPool = { ...catalogPool, solos: [...catalogPool.solos, solo] };
  }

  const writtenIds = new Set(written.map((solo) => solo.id));
  const dropped = solos.filter(
    (solo) => replaces.has(solo.id) && !writtenIds.has(solo.id),
  );

  const next = [
    ...solos.filter((solo) => !writtenIds.has(solo.id) && !replaces.has(solo.id)),
    ...written,
  ];
  await writeLibrary({ ...library, solos: next });

  // A dropped entry's clip may still belong to one that stayed.
  for (const solo of dropped) {
    for (const audio of [solo.audio, solo.soloClip?.audio]) {
      if (!audio) continue;
      if (next.some((kept) => kept.audio === audio || kept.soloClip?.audio === audio)) continue;
      await unlink(clipFile(audio)).catch(() => {});
      // The stems are named after the clip, so they orphan with it.
      for (const stem of stemFilesFor(path.basename(audio, ".mp3"))) {
        await unlink(clipFile(stem)).catch(() => {});
      }
    }
  }

  if (!body.keepSource) await dropSource(body.youtubeId);

  return { solos: written, removed: dropped.map((solo) => solo.id) };
}
