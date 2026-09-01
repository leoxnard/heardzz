import { NextResponse } from "next/server";
import { adminAvailable, isAdmin } from "./auth";

/**
 * Guard for everything that writes to the library or reaches the network on
 * the server's behalf. Returns a response to send when the caller may not be
 * here, and null when they may.
 */
export async function requireAdmin(): Promise<NextResponse | null> {
  if (!adminAvailable()) {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }
  return null;
}

export { adminAvailable, adminUnavailableReason, isAdmin } from "./auth";
