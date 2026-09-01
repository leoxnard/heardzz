import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { SOURCE_DIR, isSafeSourceName } from "@/lib/paths";

/**
 * A whole recording, while it is being marked up.
 *
 * This is the one route that serves a complete track rather than a clip, so
 * it sits behind the admin password and behind no cache at all — the file
 * exists for the length of one marking session and is deleted the moment the
 * clips have been cut from it.
 */
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { file } = await params;
  if (!isSafeSourceName(file)) {
    return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  const full = path.join(SOURCE_DIR, file);

  try {
    const info = await stat(full);
    if (!info.isFile()) throw new Error("not a file");

    // Range matters here: these are whole tracks, and a browser that seeks
    // asks for a slice rather than downloading eight minutes again.
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
      if (start >= info.size || end < start) {
        return new NextResponse(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${info.size}`, "Cache-Control": "no-store" },
        });
      }
      const stream = Readable.toWeb(createReadStream(full, { start, end })) as ReadableStream;
      return new NextResponse(stream, {
        status: 206,
        headers: {
          "Content-Type": "audio/mpeg",
          "Content-Length": String(end - start + 1),
          "Content-Range": `bytes ${start}-${end}/${info.size}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": "no-store",
        },
      });
    }

    const stream = Readable.toWeb(createReadStream(full)) as ReadableStream;
    return new NextResponse(stream, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(info.size),
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
}
