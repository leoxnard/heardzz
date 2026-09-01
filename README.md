# Heardzz

Hear a fraction of a second of a jazz recording. Name the artist and the tune.
Get it wrong and you are given more audio.

```bash
npm run dev
```

Then open <http://localhost:3000>. No database and no accounts; the library is
a JSON file and the clips are files beside it.

Anyone can suggest a record. Confirming one is behind a password. See
[Deploying](#deploying).

---

## The two answers

**Artist** is the name the record was released under, not whoever happens to be
soloing: on a Bill Evans Trio date the answer is Bill Evans even when the
passage belongs to Scott LaFaro. **Tune** is the title.

A guess can land either half. Name the artist and that field locks while you
keep working on the title; the round is won when both are in. The shared result
grid has two columns for the same reason — artist on the left, title on the
right.

There is one button, not two. Guessing and skipping both spend an attempt and
both unlock the next rung, so the control follows the fields: with something in
them it checks, with nothing in them it skips. Two buttons meant typing an
answer and then throwing it away by pressing the wrong one.

The album, the year and everybody who played on the date appear when the round
closes.

## The ladder

The default is `0.5 → 2 → 5 → 10 → 20` seconds across five attempts.

Those lengths are exact. Clips are decoded once into an `AudioBuffer` and every
snippet is scheduled on the audio clock with an explicit offset and duration,
so a rung plays the same half-second every time — and a rung of a hundred
milliseconds, if you set one, is just as precise. There are four-millisecond
ramps either side; without them you would hear the click of the cut rather than
the music.

Every playback starts at the beginning, so a later rung replays what the earlier
ones gave you before reaching new material. The band strip is a time axis and
shows exactly that: the playhead sets off from the left edge each time and
sweeps back across the bands already earned.

Everything about the ladder is editable in **Settings** — add rungs to grant
more attempts, remove them to grant fewer, type any millisecond value. The
defaults live in [`lib/config.ts`](lib/config.ts) and hot-reload when edited.
Overrides are per-device; **Reset to defaults** discards them.

## Keyboard

| Key | Does |
| --- | --- |
| `Space` | Play the snippet, or stop it. Ignored while typing in a field. |
| `Enter` | Check the guess, or skip when both fields are empty. Works from inside a field. |
| `Shift`+`Enter` | Skip regardless of what is typed. |
| `Enter` on the result | Start the next one, in Practice. |
| `Escape` | Close a panel, or dismiss the suggestion list. |

The guess fields hold focus for most of a round, which is why `Space` stands
down while you are typing and the two that matter mid-word carry a modifier or
are `Enter` itself. After a guess, focus returns to whichever half is still
open.

## Two modes

**Today** is one record per day, chosen from the date alone, so it needs nothing
server-side to be the same for everyone. **Practice** walks a different
permutation of the same library, remembering where you were between sessions.

Neither repeats until the library has been used up, and both push repeated
answers apart: two clips cut from different moments of the same recording are
allowed, but they are laid down on an even stride rather than landing in the
same week.

## Where a round starts

Rounds currently open at the top of each recording. "The top" is not reliably
second zero — uploads begin with dead air, needle drop, or encoder padding — so
the cut point is found by onset detection rather than taken on trust.

Each entry also carries `soloAt`, the moment the solo enters, kept for the
switch back:

```bash
npm run retime -- --to solo      # cut every clip at its solo instead
npm run retime -- --to opening   # and back again
```

Both re-download the sources. Nothing is lost either way: moving to the opening
records the solo time first.

## Suggestions

`/suggest` is public. Paste a YouTube link, check what comes back, send it. The
suggestion is a few hundred bytes on disk — **nothing is downloaded**, because
an open endpoint that fetches and re-encodes audio is a way to hand your server
to whoever finds it.

The download happens when you confirm the suggestion in **Library →
Suggestions**, behind the password. Rejected and confirmed suggestions stay
listed so the same record is not proposed twice.

The public lookup still reaches YouTube and Discogs to fill the fields in, so
it is rate limited per caller, and it will only read a YouTube video link —
the id is extracted and the URL rebuilt from it, never passed on as typed.

## Adding records

YouTube is the source of the file, not the player. A clip is downloaded and cut
once; the game never touches the network while you play.

In **Library** (`/admin`) there is one field. Paste a YouTube link, press
**Look it up**, and the artist, tune, album, year and the whole band on the
date come back filled in:

1. `yt-dlp` reads the upload. Music uploads carry proper tags; hand-uploaded
   videos do not, so the title is parsed — "Artist - Title" covers nearly all
   of them, and the channel name stands in when there is no separator.
2. Discogs is asked for the record, searching by tune rather than by album so a
   bare song title finds the album it came out on. Compilations are skipped
   where a single-session release exists, because a compilation's credits are
   everyone who ever played on it.
3. Everything found stays editable before you commit it.

When the automatic match picks the wrong pressing, paste a **Discogs release or
master link** and that release is used instead.

If the parse struggles with a title, set `GEMINI_API_KEY` and a model reads it
instead. Entirely optional — nothing else needs a key, and the parser runs
first either way. `GEMINI_MODEL` overrides the default of `gemini-2.5-flash`.

From the terminal, for the same thing without the form:

```bash
npm run add-track -- --search "Dexter Gordon Cheese Cake Go 1962" --artist "Dexter Gordon" --song "Cheese Cake" --album "Go!" --year 1962
```

`--url` takes an exact video instead of a search. `npm run add-track -- --help`
lists every flag. To fill in credits for records already in the library:

```bash
npm run personnel            # only the ones with none
npm run personnel -- --force # all of them, again
```

To rebuild the whole starting library from scratch:

```bash
npm run seed
```

### Confirming a start point

Two controls at two scales. The **waveform** covers the forty seconds that were
cut, with eight seconds of headroom ahead of the start point — that is why the
marker can be dragged earlier or later without going back to the network. It
shows the same instant both as a position in the clip and as a position in the
recording, and moving one moves the other. Preview at 0.5s, 2s or 6s to hear
exactly what a round will play, then **Confirm**.

Underneath, **the whole recording** is a bar end to end, with the cut window
marked on it. Drag anywhere to pick a different part of the record and press
**Re-cut here**; that one downloads the source again. Coarse on purpose —
landing near the right minute is its job, and the waveform does the seconds.

Two kinds of wrong start point are caught without you. A marker sitting in
silence is flagged in red. And a marker with no step up into it — sound before
as well as after, meaning the cut landed inside the music rather than at the
head of it — leaves the entry unconfirmed.

Set **Only play tracks with a confirmed start** in Settings to keep unconfirmed
ones out of play while you work through them.

## Requirements

- Node 20+
- `yt-dlp` and `ffmpeg` on `PATH` — `brew install yt-dlp ffmpeg`

If a download starts failing across every player client, `yt-dlp` is behind a
YouTube change. `brew upgrade yt-dlp` fixes it; the error message says so.

## Deploying

The included `Dockerfile` is the supported way, because the app shells out to
`yt-dlp` and `ffmpeg`: a plain Node image builds fine and then fails the moment
a record is confirmed.

Three things to get right.

**A password.** Set `ADMIN_PASSWORD`, ten characters or more. Without it the
library screen and every route behind it return 404 — a deploy that forgets the
variable is locked, never open. `/suggest` stays public either way.

**A volume at `/data`.** Everything written at runtime lives there: the library
file, the pending suggestions and the clips. Without a volume, confirming a
record works until the next deploy and then the record is gone.
`HEARDZZ_DATA_DIR` moves that directory if `/data` does not suit.

**The clips.** The library definition is in the repository; the audio is not,
so a fresh volume has the records and nothing to play. Open **Library** and
press *Fetch the missing clips* — it cuts them one at a time and shows how many
are left. From a shell, `npm run fetch-missing` does the same thing.

A home connection is the right place for this. The downloads come from a
residential address, which is the difference between yt-dlp working and being
turned away as a data centre.

| Variable | |
| --- | --- |
| `ADMIN_PASSWORD` | Required in production. Ten characters or more. |
| `HEARDZZ_DATA_DIR` | Where the library, suggestions and clips live. `/data` in the image. |
| `GEMINI_API_KEY` | Optional. Lets a model read awkward video titles. |
| `DISCOGS_TOKEN` | Optional. Lifts Discogs' rate limit; nothing needs it. |

## Layout

```
app/            routes; /admin and /api/admin exist in development only
components/     game UI; components/admin is the library screen
lib/
  config.ts     every tunable, with the defaults
  types.ts      the domain model
  game.ts       round rules, stats, share grid
  audio.ts      Web Audio playback
  daily.ts      date to record, the practice order, repeat spacing
  lexicon/      ~280 artists and ~510 titles, plus matching
  i18n/         all interface copy
  auth.ts       the one password, and the signed session cookie
  paths.ts      where the library and clips live
scripts/        extraction, Discogs, title parsing, CLI, seed, retime
data/solos.json the library; written by the CLI and the Library screen
data/audio/     the clips (git-ignored; a volume on a server)
```

### Adding a language

The interface is English, structured for more. Every string is in
[`lib/i18n/en.ts`](lib/i18n/en.ts) and reached through `t("some.key")` — no copy
sits in a component. A second locale is a sibling file with the same keys,
registered in the `DICTIONARIES` map in [`lib/i18n/index.ts`](lib/i18n/index.ts),
plus a switch for `DEFAULT_LOCALE`.

## A note on the audio

The clips are excerpts of copyrighted recordings. `data/audio/` is git-ignored
so they are never committed, while `data/solos.json` is tracked — the library
definition travels, the audio does not, and `npm run fetch-missing` rebuilds it
wherever it runs.

Serving them from a public address is distribution, which is a different thing
legally from keeping them on your own machine. That does not change by putting
a password on the library screen: the game itself, and every clip in it, is
whatever your server is reachable as. Worth deciding deliberately.
