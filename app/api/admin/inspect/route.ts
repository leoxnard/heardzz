import { NextResponse } from "next/server";
import { checkTools, resolveSource } from "@/scripts/extract.mjs";
import { requireAdmin } from "@/lib/admin-guard";
import { inspectSource } from "@/lib/inspect";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export type { InspectResult } from "@/lib/inspect";

/** Everything about a video that can be known without downloading it. */
export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const body = (await request.json()) as { target: string; discogs?: string };
  if (!body.target?.trim()) {
    return NextResponse.json({ error: "Paste a YouTube link first" }, { status: 400 });
  }

  try {
    await checkTools();
    const source = await resolveSource(body.target.trim());
    return NextResponse.json(await inspectSource(source, body.discogs));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Lookup failed" },
      { status: 500 },
    );
  }
}
