import { NextResponse } from "next/server";
import { adminAvailable, issueSession, passwordMatches, SESSION_COOKIE } from "@/lib/auth";
import { callerKey, take } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!adminAvailable()) {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }

  // Ten tries an hour is generous for someone who knows the password.
  const limit = take(`login:${callerKey(request)}`, 10, 60 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${limit.retryAfter} seconds.` },
      { status: 429 },
    );
  }

  const { password } = (await request.json()) as { password?: string };

  if (!password || !passwordMatches(password)) {
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }

  const session = issueSession();
  if (!session) return NextResponse.json({ error: "Not available" }, { status: 404 });

  const response = NextResponse.json({ ok: true });
  response.cookies.set(session.name, session.value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: session.maxAge,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
