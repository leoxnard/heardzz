# Heardzz

Hear a fraction of a second of a jazz recording. Name the artist and the tune.
Get it wrong and you are given more audio.

Runs locally. There is no server component beyond the dev server, no database
and no account.

```bash
npm run dev
```

Then open <http://localhost:3000>.

---

## The two answers

**Artist** is the name the record was released under, not whoever happens to be
soloing: on a Bill Evans Trio date the answer is Bill Evans even when the
passage belongs to Scott LaFaro. **Tune** is the title.

A guess can land either half. Name the artist and that field locks while you
keep working on the title; the round is won when both are in. The shared result
grid has two columns for the same reason — artist on the left, title on the
right.

Who actually takes the solo, and on what instrument, is shown when the round
closes. It is trivia, never the question.

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
| `Enter` | Submit the guess. Works from inside a field. |
| `Shift`+`Enter` | Skip. Works from inside a field. |
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

## Adding records

YouTube is the source of the file, not the player. A clip is downloaded and cut
once; the game never touches the network while you play.

From the terminal:

```bash
npm run add-track -- --search "Dexter Gordon Cheese Cake Go 1962" --artist "Dexter Gordon" --song "Cheese Cake" --soloist "Dexter Gordon" --instrument "tenor saxophone" --album "Go" --year 1962 --label "Blue Note" --solo 0:52
```

`--url` takes an exact video instead of a search. `npm run add-track -- --help`
lists every flag.

Or from **Library** (`/admin`), which does the same thing through a form and is
also where start points get confirmed.

To rebuild the whole starting library from scratch:

```bash
npm run seed
```

### Confirming a start point

Each clip carries eight seconds of audio ahead of its start point. That headroom
is why the marker can be dragged earlier or later without going back to the
network — the screen shows the same instant both as a position in the clip and
as a position in the source recording, and moving one moves the other. Preview
at 0.5s, 2s or 6s to hear exactly what a round will play, then **Confirm**.

If the moment you want is not inside the clip at all, the embedded source player
below finds it, and **Re-cut from a new time** downloads it again around that
point.

One kind of wrong start point is caught without you: if the marker sits in
silence, the import warns and the Library screen says so in red.

Set **Only play tracks with a confirmed start** in Settings to keep unconfirmed
ones out of play while you work through them.

## Requirements

- Node 20+
- `yt-dlp` and `ffmpeg` on `PATH` — `brew install yt-dlp ffmpeg`

If a download starts failing across every player client, `yt-dlp` is behind a
YouTube change. `brew upgrade yt-dlp` fixes it; the error message says so.

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
scripts/        extraction pipeline, CLI, seed list, retime
data/solos.json the library; written by the CLI and the Library screen
public/audio/   the clips (git-ignored)
```

### Adding a language

The interface is English, structured for more. Every string is in
[`lib/i18n/en.ts`](lib/i18n/en.ts) and reached through `t("some.key")` — no copy
sits in a component. A second locale is a sibling file with the same keys,
registered in the `DICTIONARIES` map in [`lib/i18n/index.ts`](lib/i18n/index.ts),
plus a switch for `DEFAULT_LOCALE`.

## A note on the audio

The clips are excerpts of copyrighted recordings, held locally for private use.
`public/audio/` is git-ignored so they are never committed, while
`data/solos.json` is tracked — the library definition travels, the audio does
not, and `npm run seed` rebuilds it.

Putting these files on a public URL is distribution, which is a different thing
legally from keeping them on your own machine. The `/admin` routes return 404
outside development for the same reason.
