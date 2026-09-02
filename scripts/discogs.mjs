/* ------------------------------------------------------------------
   Personnel from Discogs.

   Discogs credits a release, not a track, so what comes back is the band
   on the date — which is what "who else is playing" means for a jazz
   album. The public database endpoints answer without a token; all they
   ask for is an honest User-Agent and a slow hand.
   ------------------------------------------------------------------ */

const USER_AGENT = "Heardzz/0.1 +https://github.com/leoxnard/heardzz";
const API = "https://api.discogs.com";

/*
 * Discogs allows 25 requests a minute without a token and 60 with one. The
 * pause between calls is set from that rather than fixed, because a single
 * lookup can be five requests: one search and up to four pressings. Fixed at
 * the anonymous rate, a token would buy nothing.
 */
const THROTTLE_ANONYMOUS_MS = 2600;
const THROTTLE_WITH_TOKEN_MS = 1100;

let lastCall = 0;

async function call(path) {
  const throttle = process.env.DISCOGS_TOKEN
    ? THROTTLE_WITH_TOKEN_MS
    : THROTTLE_ANONYMOUS_MS;

  const wait = Math.max(0, lastCall + throttle - Date.now());
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastCall = Date.now();

  const headers = { "User-Agent": USER_AGENT };
  // A personal token lifts the rate limit; nothing here requires one.
  if (process.env.DISCOGS_TOKEN) {
    headers.Authorization = `Discogs token=${process.env.DISCOGS_TOKEN}`;
  }

  const response = await fetch(`${API}${path}`, { headers });
  if (!response.ok) {
    throw new Error(`Discogs ${response.status} for ${path.split("?")[0]}`);
  }
  return response.json();
}

/**
 * Roles that are not someone playing on the record. A blocklist rather than
 * a list of instruments: there are far more instruments than there are ways
 * to be credited for the sleeve.
 */
const NOT_A_PLAYER =
  /(producer|engineer|master|mixed|mixing|recorded by|remix|edited|liner notes|notes|photograph|design|artwork|art direction|illustration|cover|sleeve|written|composed|arranged|lacquer|coordinat|supervis|transferred|research|compiled|directed|editor|translat|typography|layout|management|a&r|legal|concept|executive|reissue|restoration|technician|assistant|curat|selected|programm)/i;

/** Discogs disambiguates same-named artists with a trailing "(2)". */
function cleanName(name) {
  return name.replace(/\s*\(\d+\)\s*$/, "").trim();
}

function playingRoles(role) {
  return String(role || "")
    .split(",")
    .map((part) => part.replace(/\[[^\]]*\]/g, "").trim())
    .filter((part) => part && !NOT_A_PLAYER.test(part));
}

/**
 * Candidate pressings, oldest first.
 *
 * Discogs ranks by popularity, which surfaces whichever reissue sells; asking
 * for albums sorted by year instead lands on the record the music first came
 * out on. Searching by track rather than by album title is what lets a bare
 * song name find its home: "Cheese Cake" resolves to Go!, not to whichever
 * compilation is currently fashionable.
 */
async function search(params) {
  const query = new URLSearchParams({
    ...params,
    type: "release",
    format: "Album",
    sort: "year",
    sort_order: "asc",
    per_page: "10",
  });
  const { results = [] } = await call(`/database/search?${query}`);
  const dated = results.filter((r) => Number(r.year) > 0);

  // A compilation's credits are everyone who played across every session it
  // collects — six pianists on a Charlie Parker anthology. Prefer a release
  // that is one date, and fall back only when there is nothing else.
  const sessions = dated.filter(
    (r) => !(r.format || []).some((f) => /compilation|anthology|box set/i.test(f)),
  );
  return sessions.length > 0 ? sessions : dated;
}

export async function findRelease(artist, album) {
  const results = await search({ artist, release_title: album });
  return results[0] ? { id: results[0].id, title: results[0].title, year: results[0].year } : null;
}

export async function findReleaseByTrack(artist, song) {
  const results = await search({ artist, track: song });
  return results.slice(0, 4).map((r) => ({ id: r.id, title: r.title, year: r.year }));
}

/* ------------------------------------------------------------------
   Picking the right pressing.

   Discogs answers "Miles Davis / So What" with a dozen releases and only
   some of them are the record. The rest are anthologies, all-star packages
   and split billings — "Miles Davis, John Coltrane, Bill Evans" is a real
   Discogs artist string and it is not what Kind Of Blue was released under.
   Taking whichever pressing lists the most names walks straight into those,
   because a package of four sessions credits four rhythm sections.

   So candidates are scored rather than counted: the billing has to look
   like the artist we already have, the credits have to look like one date,
   and a fuller line-up breaks the tie rather than deciding it.
   ------------------------------------------------------------------ */

/** Discogs titles read "Artist - Album". The billing is the left half. */
function billingOf(title) {
  const text = String(title || "");
  const cut = text.indexOf(" - ");
  return cut === -1 ? "" : text.slice(0, cut);
}

function nameKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s*\(\d+\)\s*/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|a|an|his|her|and|with|featuring|feat)\b/g, " ")
    .replace(/\b(orchestra|big band|band|quintet|quartet|trio|duo|sextet|septet|octet|nonet|ensemble|group|combo|all ?stars?|jazz messengers)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * How the release is billed against the artist we are looking for.
 *
 * "exact" is the record released under that name. "leading" is a split
 * billing this artist heads — common and usually still the right session.
 * "among" is a billing they are merely named in, which is what an all-star
 * package looks like. "none" is a different act entirely.
 */
function billingMatch(title, artist) {
  const wanted = nameKey(artist);
  if (!wanted) return "unknown";

  const billing = billingOf(title);
  if (!billing) return "unknown";
  if (/^various/i.test(billing)) return "various";

  const parts = billing
    .split(/\s*[,/]\s*|\s+&\s+|\s+\band\b\s+/i)
    .map(nameKey)
    .filter(Boolean);

  if (parts.length === 0) return "unknown";
  if (parts.length === 1 && parts[0] === wanted) return "exact";
  // Three names on the marquee is a package, not a band, even when ours is
  // the first of them: "Miles Davis, John Coltrane, Bill Evans" is how a
  // label sells four sessions at once.
  if (parts.length >= 3) return parts.includes(wanted) ? "package" : "none";
  if (parts[0] === wanted) return "leading";
  if (parts.includes(wanted)) return "among";
  return nameKey(billing).includes(wanted) ? "leading" : "none";
}

export { billingMatch };

const BILLING_SCORE = {
  exact: 40,
  leading: 18,
  unknown: 0,
  among: -20,
  package: -35,
  various: -45,
  none: -30,
};

/**
 * The best of a few candidate pressings, by score.
 *
 * The earliest pressing is the one closest to the original date, but it is
 * often also the one nobody typed the sleeve notes into. Walking a handful
 * costs a few seconds and is the difference between "Miles Davis" and the
 * whole sextet — as long as the walk cannot wander onto a compilation,
 * which is what the billing and the compilation flag are for.
 */
async function bestOf(candidates, song, artist) {
  let best = null;
  let bestScore = -Infinity;

  for (const [index, candidate] of candidates.slice(0, 4).entries()) {
    const { personnel, suspect } = await fetchPersonnel(candidate.id, song);
    const match = artist ? billingMatch(candidate.title, artist) : "unknown";

    const score =
      BILLING_SCORE[match]
      // A fuller line-up is better, but only up to a sextet's worth: past
      // that, more names is evidence of a compilation, not of better notes.
      + Math.min(personnel.length, 8) * 3
      + (suspect ? -30 : 0)
      // Candidates arrive oldest first, and the oldest is the session.
      - index * 3;

    const found = { ...candidate, personnel, suspect, billing: match, artist: billingOf(candidate.title) };
    if (score > bestScore) {
      best = found;
      bestScore = score;
    }
    // The record, credited, under its own name: nothing left to look for.
    if (!suspect && match === "exact" && personnel.length >= 4) break;
  }

  return best;
}

/** Accepts a /release/123 or /master/456 URL, or a bare id. */
export function parseDiscogsUrl(input) {
  const text = String(input || "").trim();
  if (/^\d+$/.test(text)) return { type: "release", id: Number(text) };

  const release = /discogs\.com\/(?:[a-z]{2}\/)?release\/(\d+)/i.exec(text);
  if (release) return { type: "release", id: Number(release[1]) };

  const master = /discogs\.com\/(?:[a-z]{2}\/)?master\/(\d+)/i.exec(text);
  if (master) return { type: "master", id: Number(master[1]) };

  return null;
}

/** A master points at the pressing Discogs considers definitive. */
export async function resolveMaster(masterId) {
  const master = await call(`/masters/${masterId}`);
  return { id: master.main_release, title: master.title, year: master.year };
}

function collect(byName, credits) {
  for (const credit of credits || []) {
    const roles = playingRoles(credit.role);
    if (roles.length === 0) continue;
    const name = cleanName(credit.name);
    byName.set(name, [...new Set([...(byName.get(name) ?? []), ...roles])]);
  }
}

/**
 * Chairs a band has one of.
 *
 * Counting every doubled instrument catches a big band rather than a
 * compilation: Ellington's orchestra has five saxophones, four trumpets and
 * three trombones on purpose, and reading that as an anthology threw away
 * the credits of every large-ensemble record in the library. Sections are
 * meant to be crowded; a rhythm section is not.
 */
const ONE_TO_A_BAND =
  /^(piano|electric piano|rhodes|bass|double bass|acoustic bass|electric bass|bass guitar|drums|guitar|vibraphone|vibes|organ|banjo)$/;

/**
 * One rhythm chair credited to three or more people is the signature of a
 * compilation: the release lists everyone who played across years of
 * sessions, not the band on one date. Three, not two, because a single date
 * really can carry two pianists — Kind Of Blue does.
 *
 * Worth saying out loud rather than presenting as the line-up.
 */
function looksLikeCompilation(personnel) {
  const counts = new Map();
  for (const { role } of personnel) {
    for (const part of role.split(",").map((r) => r.trim().toLowerCase())) {
      if (!ONE_TO_A_BAND.test(part)) continue;
      counts.set(part, (counts.get(part) ?? 0) + 1);
    }
  }
  // Past twenty names it is a box set whatever the instruments say; a big
  // band tops out around seventeen.
  return [...counts.values()].some((n) => n >= 3) || personnel.length > 20;
}

export async function fetchPersonnel(releaseId, songTitle) {
  const release = await call(`/releases/${releaseId}`);

  const byName = new Map();
  collect(byName, release.extraartists);

  // Track credits sit alongside the release credits rather than replacing
  // them; Discogs only lists the player who differs on that particular cut.
  if (songTitle) {
    const wanted = songTitle.toLowerCase().replace(/[^a-z0-9]/g, "");
    for (const track of release.tracklist || []) {
      const title = String(track.title || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      if (title === wanted) collect(byName, track.extraartists);
    }
  }

  // A leader sometimes appears only as the release artist, with no credit line.
  if (byName.size === 0) {
    for (const artist of release.artists || []) byName.set(cleanName(artist.name), []);
  }

  const personnel = [...byName.entries()]
    .map(([name, roles]) => ({ name, role: roles.join(", ") }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { personnel, suspect: looksLikeCompilation(personnel) };
}

/** Discogs titles read "Artist - Album"; compare on the album half only. */
function albumMatches(resultTitle, album) {
  const norm = (v) =>
    String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const right = norm(String(resultTitle).replace(/^.*?\s+-\s+/, ""));
  const wanted = norm(album);
  return wanted.length > 0 && (right.includes(wanted) || wanted.includes(right));
}

export async function lookupPersonnel(artist, album, songTitle) {
  const all = await search({ artist, release_title: album });

  // Discogs search is fuzzy enough to answer "Go" with "The Resurgence Of
  // Dexter Gordon". Keep only pressings whose title is actually the album.
  const exact = all.filter((r) => albumMatches(r.title, album));
  const candidates = exact.length > 0 ? exact : all;

  if (candidates.length === 0) return { personnel: [], release: null, suspect: false };

  const best = await bestOf(
    candidates.map((r) => ({ id: r.id, title: r.title, year: r.year })),
    songTitle,
    artist,
  );
  if (!best) return { personnel: [], release: null, suspect: false };

  return { personnel: best.personnel, release: best, suspect: best.suspect };
}

/**
 * Everything Discogs can say about a record, found from artist and song alone.
 *
 * The first pressing is not always the one somebody bothered to credit, so a
 * couple of candidates are tried and the fullest credit list wins.
 */
export async function lookupByTrack(artist, song) {
  const candidates = await findReleaseByTrack(artist, song);
  if (candidates.length === 0) return null;
  return bestOf(candidates, song, artist);
}

/** Everything Discogs can say about one release the user pointed at. */
export async function lookupByRelease(reference, song) {
  const parsed = parseDiscogsUrl(reference);
  if (!parsed) return null;

  const target =
    parsed.type === "master" ? await resolveMaster(parsed.id) : { id: parsed.id };

  const release = await call(`/releases/${target.id}`);
  const { personnel, suspect } = await fetchPersonnel(target.id, song);

  const billed = (release.artists || []).map((a) => cleanName(a.name)).join(", ");

  return {
    id: target.id,
    title: release.title,
    year: Number(release.year) || Number(target.year) || 0,
    artist: billed,
    personnel,
    suspect,
    // A link pasted by hand is a decision, not a guess — but the screen
    // still says how it is billed, because that is what goes wrong.
    billing: billingMatch(release.title, billed),
    billedAs: billed,
  };
}
