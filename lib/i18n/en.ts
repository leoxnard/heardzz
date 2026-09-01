/* ------------------------------------------------------------------
   Every string in the interface lives here. Components never hold copy
   directly, so adding a second locale is a matter of writing a sibling
   file with the same keys and switching which one `t` reads from.
   ------------------------------------------------------------------ */

export const en = {
  brand: "Heardzz",
  tagline: "Name the record",

  nav: {
    daily: "Today",
    practice: "Practice",
    stats: "Stats",
    settings: "Settings",
    admin: "Library",
  },

  round: {
    eyebrow: "Record",
    attemptOf: "Attempt {n} of {total}",
    listen: "Listen",
    playing: "Playing",
    replay: "Play again",
    unlocked: "{ms} unlocked",
    skip: "Skip",
    submit: "Guess",
    giveUp: "Give up",
    artistLabel: "Which artist",
    songLabel: "Which tune",
    artistPlaceholder: "Start typing a name",
    songPlaceholder: "Start typing a title",
    artistSolved: "Artist found",
    songSolved: "Title found",
    noGuess: "Type a name or a title first, or skip to hear more.",
    keysHint: "Space plays · Enter guesses · Shift+Enter skips",
    keysHintRevealed: "Space plays it",
    keysHintNext: "Space plays · Enter starts the next one",
    lockedField: "Already found",
  },

  board: {
    empty: "No guesses yet",
    skipped: "Skipped",
    wrong: "Not this one",
  },

  result: {
    won: "Got it",
    lost: "Out of attempts",
    wonIn: "Solved on attempt {n}",
    heardFor: "You heard {ms} of it",
    answerArtist: "Artist",
    answerSong: "Title",
    soloBy: "Solo on this take",
    from: "from",
    recordedIn: "Recorded {year} · {label}",
    listenFull: "Hear the whole clip",
    openSource: "Open on YouTube",
    share: "Copy result",
    shared: "Copied",
    nextDaily: "Next solo in {time}",
    playAnother: "Play another",
  },

  stats: {
    title: "Stats",
    played: "Played",
    winRate: "Win rate",
    streak: "Streak",
    maxStreak: "Best streak",
    distribution: "Solved on attempt",
    empty: "Play a round and this fills in.",
    reset: "Clear stats",
    resetConfirm: "Clear every stat and streak? This cannot be undone.",
  },

  settings: {
    title: "Settings",
    intro: "Changes apply immediately and are remembered on this device.",
    ladder: "Snippet ladder",
    ladderHelp:
      "How much audio each attempt unlocks. One row per attempt — add a row to give another guess.",
    addRung: "Add attempt",
    removeRung: "Remove",
    presets: "Presets",
    guessSong: "Ask for the title as well as the artist",
    skipCosts: "A skip uses up an attempt",
    leadIn: "Lead-in before the solo",
    leadInHelp: "Extra audio played ahead of the start point. Zero is the honest setting.",
    verifiedOnly: "Only play tracks with a confirmed start",
    volume: "Volume",
    reset: "Reset to defaults",
    close: "Close",
  },

  library: {
    title: "Library",
    intro:
      "Confirm where each round starts. Drag the marker or type a time, then play it back.",
    unverified: "{n} unverified",
    allVerified: "Every timestamp confirmed.",
    filterAll: "All",
    filterUnverified: "Unverified",
    add: "Add a solo",
    search: "YouTube search or URL",
    soloAt: "Round starts at",
    inClip: "In this clip",
    inSource: "In the source recording",
    preview: "Preview from here",
    stop: "Stop",
    markVerified: "Confirm timestamp",
    verified: "Confirmed",
    recut: "Re-cut from a new time",
    recutHelp:
      "Use this when the right moment is not inside the clip at all. It downloads the source again.",
    save: "Save",
    saving: "Saving",
    delete: "Remove",
    deleteConfirm: "Remove {song} — {artist} from the library?",
    empty: "The library is empty. Run npm run seed, or add a solo below.",
    sourcePreview: "Find the moment in the source",
    importing: "Downloading and cutting",
    importFailed: "Import failed",
    silentWarning:
      "There is no sound here. The marker is in a gap — move it, or re-cut from a time where the music actually starts.",
  },

  a11y: {
    playButton: "Play the snippet",
    ladderStage: "Attempt {n}, {ms} of audio",
    closeDialog: "Close",
  },
} as const;

export type Dictionary = typeof en;
