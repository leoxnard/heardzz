/* ------------------------------------------------------------------
   A small in-memory limiter.

   Enough to stop one impatient visitor from queuing a hundred downloads or
   guessing a password at speed. It lives in the process, so it resets on
   deploy — which is the right trade for a single-server app that should
   not need a database to be safe.
   ------------------------------------------------------------------ */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Keep the map from growing without bound on a long-lived process. */
function sweep(now: number) {
  if (buckets.size < 5000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export interface Verdict {
  allowed: boolean;
  /** Seconds until the caller may try again. */
  retryAfter: number;
}

export function take(key: string, limit: number, windowMs: number): Verdict {
  const now = Date.now();
  sweep(now);

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfter: 0 };
  }

  bucket.count += 1;
  if (bucket.count <= limit) return { allowed: true, retryAfter: 0 };

  return { allowed: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
}

/**
 * Best guess at who is calling. Behind a reverse proxy this is whatever the
 * proxy forwards; direct, it falls back to a single shared bucket, which is
 * strict rather than permissive and so fails the right way.
 */
export function callerKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}
