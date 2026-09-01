import crypto from "node:crypto";
import { cookies } from "next/headers";

/* ------------------------------------------------------------------
   Who may confirm a record.

   One password in the environment, no accounts and no database. The
   cookie carries an expiry and a signature over it, so it cannot be
   forged or extended by whoever holds it.

   In development the library screen is open, as it always was. In
   production it needs ADMIN_PASSWORD, and without one it does not exist
   at all — a deploy that forgets the variable is locked, never open.
   ------------------------------------------------------------------ */

const COOKIE = "heardzz_admin";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const MIN_PASSWORD_LENGTH = 10;

export const isDevelopment = process.env.NODE_ENV !== "production";

function secret(): string | null {
  const password = process.env.ADMIN_PASSWORD;
  return password && password.length >= MIN_PASSWORD_LENGTH ? password : null;
}

/** Whether an admin password is configured at all. */
export function adminConfigured(): boolean {
  return secret() !== null;
}

/** Whether the library screen exists in this deployment. */
export function adminAvailable(): boolean {
  return isDevelopment || adminConfigured();
}

/** Why it does not, when it does not. */
export function adminUnavailableReason(): string | null {
  if (adminAvailable()) return null;
  return process.env.ADMIN_PASSWORD
    ? `ADMIN_PASSWORD is shorter than ${MIN_PASSWORD_LENGTH} characters, so the library screen stays closed.`
    : "ADMIN_PASSWORD is not set, so the library screen stays closed.";
}

function sign(expiry: number, key: string): string {
  return crypto.createHmac("sha256", key).update(`admin.${expiry}`).digest("hex");
}

function equal(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function passwordMatches(candidate: string): boolean {
  const key = secret();
  if (!key) return false;
  // Hash both sides first: timingSafeEqual needs equal lengths, and comparing
  // digests avoids leaking the password's length along the way.
  const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
  return equal(hash(candidate), hash(key));
}

export interface SessionCookie {
  name: string;
  value: string;
  maxAge: number;
}

export function issueSession(): SessionCookie | null {
  const key = secret();
  if (!key) return null;
  const expiry = Date.now() + MAX_AGE_SECONDS * 1000;
  return {
    name: COOKIE,
    value: `${expiry}.${sign(expiry, key)}`,
    maxAge: MAX_AGE_SECONDS,
  };
}

export const SESSION_COOKIE = COOKIE;

function tokenIsValid(token: string | undefined): boolean {
  const key = secret();
  if (!key || !token) return false;

  const [rawExpiry, signature] = token.split(".");
  const expiry = Number(rawExpiry);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return false;

  return equal(signature ?? "", sign(expiry, key));
}

/** Signed in, or running locally where the screen is open anyway. */
export async function isAdmin(): Promise<boolean> {
  if (isDevelopment) return true;
  if (!adminConfigured()) return false;

  const store = await cookies();
  return tokenIsValid(store.get(COOKIE)?.value);
}
