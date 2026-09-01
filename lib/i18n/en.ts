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
    suggest: "Suggest",
  },

  /** Category names, short enough for the board and the settings blurbs. */
  field: {
    artist: "Artist",
    song: "Title",
    soloist: "Soloist",
  },

  round: {
    eyebrow: "Record",
    attemptOf: "Attempt {n}",
    missesLeft: "{n} wrong answers left",
    listen: "Listen",
    playing: "Playing",
    replay: "Play again",
    unlocked: "{ms} unlocked",
    skip: "Skip — hear more",
    submit: "Check it",
    giveUp: "Give up",
    artistLabel: "Which artist",
    songLabel: "Which tune",
    artistPlaceholder: "Start typing an artist",
    songPlaceholder: "Start typing a title",
    soloistLabel: "Who is soloing",
    soloistPlaceholder: "Start typing a name",
    artistSolved: "Artist found",
    songSolved: "Title found",
    soloistSolved: "Soloist found",
    choiceLabel: "Which artist",
    choiceHelp: "One of these five.",
    keysHint: "Space plays · Enter checks · a right answer costs you nothing",
    keysHintRevealed: "Space plays it",
    keysHintNext: "Space plays · Enter starts the next one",
    lockedField: "Already found",
    audioMissing: "This clip will not load",
    audioMissingHelp:
      "The file is not reachable from here. If this was just added, give it a moment; otherwise it needs fetching again in the library.",
  },

  board: {
    empty: "No guesses yet",
    skipped: "Skipped",
    wrong: "Not this one",
  },

  result: {
    won: "Got it",
    lost: "Out of attempts",
    heardFor: "You heard {ms} of it",
    answerArtist: "Artist",
    answerSong: "Title",
    answerSoloist: "Soloing",
    personnel: "On the date",
    from: "from",
    recordedIn: "Recorded {year}",
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
    distribution: "Solved on",
    empty: "Play a round and this fills in.",
    reset: "Clear stats",
    resetConfirm: "Clear every stat and streak? This cannot be undone.",
  },

  settings: {
    title: "Settings",
    intro: "Changes apply immediately and are remembered on this device.",
    levels: "Level",
    levelsHelp:
      "The clock is the same at every level. What changes is where the clip starts and how much the record has to tell you.",
    ladder: "Snippet ladder",
    ladderHelp:
      "How much audio a wrong answer unlocks. One row per wrong answer — a right one costs nothing and leaves the ladder where it is.",
    addRung: "Add a rung",
    removeRung: "Remove",
    presets: "Ladder presets",
    guessSong: "Ask for the title as well as the artist",
    skipCosts: "A skip counts as a wrong answer",
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
    search: "YouTube link",
    discogsLink: "Discogs link",
    discogsHelp:
      "Optional. Everything is looked up from the YouTube link alone; add a Discogs release only when the automatic match finds the wrong pressing, or none at all.",
    lookUp: "Look it up",
    lookingUp: "Looking it up",
    found: "What was found",
    soloist: "Who is soloing",
    soloistHelp:
      "The hardest level asks for this by name, and it is often not the artist on the sleeve — Moanin' is an Art Blakey record and a Lee Morgan solo.",
    personnelCount: "On the date — {n} credited",
    noPersonnel:
      "Discogs credited nobody on this release. Add a Discogs link to a pressing that lists the band.",
    importingHelp: "Downloading the source and cutting a 40 second window from the opening.",
    soloAt: "Round starts at",
    inClip: "In this clip",
    inSource: "In the source recording",
    preview: "Preview from here",
    stop: "Stop",
    markVerified: "Confirm timestamp",
    verified: "Confirmed",
    cutSoloClip: "Cut the solo clip",
    soloClipCut: "The hard levels open at {time}.",
    soloClipMissing:
      "No solo clip yet — the hard levels fall back to the opening, which makes them easier than they should be.",
    recut: "Re-cut from a new time",
    recutHelp:
      "Use this when the right moment is not inside the clip at all. It downloads the source again.",
    save: "Save",
    saving: "Saving",
    delete: "Remove",
    deleteConfirm: "Remove {song} — {artist} from the library?",
    empty: "The library is empty. Run npm run seed, or add a record below.",
    missingAudio:
      "{n} records have no audio on this server. The library travels with the deploy; the clips do not, and have to be cut here.",
    fetchAudio: "Fetch the missing clips",
    fetchingAudio: "Fetching — {n} to go",
    sourcePreview: "Find the moment in the source",
    wholeRecording: "The whole recording",
    wholeRecordingHelp:
      "The waveform above covers only the forty seconds that were cut. Drag here to pick a different part of the record, then re-cut — it downloads the source again.",
    recutHere: "Re-cut here",
    fetchCredits: "Fetch from Discogs",
    addCredit: "Add a name",
    importing: "Downloading and cutting",
    importFailed: "Import failed",
    silentWarning:
      "There is no sound here. The marker is in a gap — move it, or re-cut from a time where the music actually starts.",
  },

  login: {
    title: "Sign in",
    intro: "The library screen is for whoever runs this. Everyone else can suggest a record.",
    password: "Password",
    signIn: "Sign in",
    signingIn: "Signing in",
    signOut: "Sign out",
  },

  suggest: {
    title: "Suggest a record",
    intro:
      "Paste a YouTube link, or a playlist link for a whole run of them. The artist, tune, album, year and the band on the date are looked up for you — check them, then send it over.",
    link: "YouTube link or playlist",
    lookUp: "Look it up",
    lookingUp: "Looking it up",
    found: "What was found",
    note: "Anything worth saying about it",
    submit: "Send it over",
    submitting: "Sending",
    thanks: "Sent. It joins the library once it has been confirmed.",
    another: "Suggest another",
    badLink: "That is not a YouTube video or playlist link.",
    alreadyHere: "That record is already in the library.",
    alreadyPending: "That one is already waiting to be confirmed.",
    nothingFound: "Nothing came back for that link. Fill the fields in yourself if you know them.",
    badPlaylist: "That playlist could not be read. It may be private or empty.",
    playlistAllKnown: "Everything in that playlist is already here or already waiting.",
    playlistFound: "{n} from that playlist",
    playlistSkipped: "{n} left out — already here or already waiting.",
    playlistTruncated: "Only the first {n} are read at a time.",
    playlistPick: "Untick anything that should not go over.",
    playlistNothingPicked: "Nothing is ticked.",
    playlistSelectAll: "Tick all",
    playlistSelectNone: "Untick all",
    playlistSubmit: "Send {n} over",
    playlistSent: "{n} sent. They join the library once they have been confirmed.",
    playlistSomeRejected: "{n} could not be sent.",
  },

  review: {
    title: "Suggestions",
    pending: "{n} waiting",
    none: "Nothing waiting.",
    submitted: "Suggested {when}",
    approve: "Confirm and add",
    approving: "Downloading and cutting",
    reject: "Turn down",
    rejected: "Turned down",
    approved: "Added to the library",
    openVideo: "Watch on YouTube",
    tab: "Suggestions",
    tabLibrary: "Library",
  },

  a11y: {
    playButton: "Play the snippet",
    ladderStage: "Attempt {n}, {ms} of audio",
    closeDialog: "Close",
  },
} as const;

export type Dictionary = typeof en;
