import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { AUDIO_DIR, isSafeAudioName } from "@/lib/paths";

/**
 * A clip that is missing today may exist in ten minutes — the library ships
 * without its audio, and records are added by confirming a suggestion. A CDN
 * that caches the "not yet" answer keeps serving it long after the file
 * arrives, which reads as a broken game rather than a stale cache. So the
 * absence is never cacheable; only the audio is.
 */
const NOT_FOUND = () =>
  new NextResponse("Not found", {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });

/**
 * Serve a clip from the data directory.
 *
 * Clips are not in public/ because they are written after the build. The
 * filename is checked against the shape slugify produces rather than merely
 * sanitised, so nothing that is not a clip can be asked for.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;

  if (!isSafeAudioName(file)) return NOT_FOUND();

  const full = path.join(AUDIO_DIR, file);

  try {
    const info = await stat(full);
    if (!info.isFile()) return NOT_FOUND();

    const stream = Readable.toWeb(createReadStream(full)) as ReadableStream;

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(info.size),
        // A clip only changes when it is re-cut, and then under a new mtime.
        "Cache-Control": "public, max-age=3600, must-revalidate",
      },
    });
  } catch {
    return NOT_FOUND();
  }
}
