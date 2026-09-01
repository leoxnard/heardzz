import { NextResponse } from "next/server";

/**
 * The library screen writes to disk and shells out to yt-dlp. That is fine on
 * a laptop and unacceptable anywhere else, so it simply does not exist outside
 * development.
 */
export function blockedInProduction(): NextResponse | null {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }
  return null;
}

export const isAdminEnabled = process.env.NODE_ENV !== "production";
