import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { AUDIO_DIR, isSafeAudioName } from "@/lib/paths";

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

  if (!isSafeAudioName(file)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const full = path.join(AUDIO_DIR, file);

  try {
    const info = await stat(full);
    if (!info.isFile()) return new NextResponse("Not found", { status: 404 });

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
    return new NextResponse("Not found", { status: 404 });
  }
}
