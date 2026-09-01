import type { Solo } from "./types";

/**
 * The daily pick.
 *
 * Deterministic from the date alone, so every player on a given day gets the
 * same solo without a server deciding anything. The library is reshuffled
 * once per full cycle through it, which means nothing repeats until every
 * solo has been used — and the order changes on the next lap.
 */

const EPOCH = Date.UTC(2026, 0, 1);

export function todayKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function daysSinceEpoch(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d) - EPOCH;
  return Math.floor(ms / 86_400_000);
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], seed: number): T[] {
  const out = [...items];
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The answer a solo resolves to. Two clips from different moments of the same
 * recording are two puzzles with one answer, which is allowed — but they
 * should not turn up in the same week.
 */
function answerKey(solo: Solo): string {
  return `${solo.artist}\u0000${solo.song}`;
}

function nearestFreeSlot(slots: (Solo | null)[], target: number): number {
  const n = slots.length;
  for (let offset = 0; offset < n; offset++) {
    const forward = (target + offset) % n;
    if (slots[forward] === null) return forward;
    const back = ((target - offset) % n + n) % n;
    if (slots[back] === null) return back;
  }
  return 0;
}

/**
 * Push repeated answers as far apart as the run allows.
 *
 * A plain shuffle is happy to deal the three "So What" clips on consecutive
 * days, and the second one gives itself away. Each repeated answer is instead
 * laid down on an even stride across the whole run — three in twenty land
 * about seven apart — and the one-offs fill the gaps left over.
 */
function spreadRepeats(ordered: Solo[]): Solo[] {
  const buckets = new Map<string, Solo[]>();
  for (const solo of ordered) {
    const key = answerKey(solo);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(solo);
    else buckets.set(key, [solo]);
  }

  const repeated = [...buckets.values()].filter((b) => b.length > 1);
  if (repeated.length === 0) return ordered;

  // Largest first: the answer that repeats most has the least room to move.
  repeated.sort((a, b) => b.length - a.length);

  const n = ordered.length;
  const slots: (Solo | null)[] = new Array(n).fill(null);

  repeated.forEach((bucket, bucketIndex) => {
    const stride = n / bucket.length;
    // Offset each bucket a little so two repeated answers do not share a rhythm.
    const phase = (bucketIndex * stride) / (repeated.length + 1);
    bucket.forEach((solo, i) => {
      const target = Math.round(i * stride + phase) % n;
      slots[nearestFreeSlot(slots, target)] = solo;
    });
  });

  const singles = [...buckets.values()].filter((b) => b.length === 1).map((b) => b[0]);
  let next = 0;
  for (let i = 0; i < n; i++) {
    if (slots[i] === null) slots[i] = singles[next++];
  }

  return slots as Solo[];
}

export function pickDaily(solos: Solo[], dateKey: string): Solo | null {
  if (solos.length === 0) return null;

  const day = daysSinceEpoch(dateKey);
  const size = solos.length;

  // Negative days (playing "before" the epoch) still need a stable answer.
  const index = ((day % size) + size) % size;
  const cycle = Math.floor(day / size);

  const ordered = spreadRepeats(
    shuffle([...solos].sort((a, b) => a.id.localeCompare(b.id)), cycle * 2654435761 + size),
  );

  return ordered[index];
}

/**
 * The practice order: the same library, permuted once, walked by an index.
 * Deterministic — which keeps it out of render-purity trouble and, more to
 * the point, means practice never hands you the same solo twice in a row.
 */
export function pickSequential(solos: Solo[], index: number): Solo | null {
  if (solos.length === 0) return null;
  const size = solos.length;
  const lap = Math.floor(index / size);
  const position = ((index % size) + size) % size;

  const ordered = spreadRepeats(
    shuffle([...solos].sort((a, b) => a.id.localeCompare(b.id)), lap * 40503 + size * 7),
  );
  return ordered[position];
}

/** Milliseconds until local midnight, for the countdown on the result card. */
export function msUntilTomorrow(now: Date = new Date()): number {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next.getTime() - now.getTime();
}

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
