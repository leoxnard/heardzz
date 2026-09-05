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
    forYou: "For you",
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
    reportLink: "Something wrong with this one?",
  },

  /* The player's side of a report — the button on the sleeve and the panel it opens. */
  report: {
    title: "Report a problem",
    intro: "What's wrong with this record?",
    kindAudio: "The clip doesn't play, or sounds wrong",
    kindInfo: "The artist, title, or soloist is wrong",
    kindOther: "Something else",
    noteLabel: "Anything else worth saying (optional)",
    notePlaceholder: "e.g. the clip cuts off early",
    submit: "Send report",
    sending: "Sending",
    sent: "Thanks — this has been flagged for a look.",
    error: "Could not send that. Try again in a moment.",
    rateLimited: "You've sent a few of these already — give it a little while.",
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
    tryPractice: "Not ready to wait? Play practice mode",
    playAnother: "Play another",
    nextLevel: "Next round",
    nextLevelHelp: "Starts with the next record.",
    levelKept: "Kept for every round from here.",
  },

  /** The level, as it reads on the round screen rather than in settings. */
  level: {
    change: "Change level",
    fixedDaily:
      "Today's round is Standard for everybody — artist and title, from the top of the tune. What you pick here is for practice.",
    notHere:
      "The solo levels are not offered here — nothing in this sitting has had its solo marked yet.",
    noSolos:
      "No record here has its solo marked yet, so this level has nothing to open. Pick an easier level and the round starts at the top of the tune.",
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
    stems: "What you hear",
    stemsHelp:
      "The record can be pulled apart and played in pieces. Which part is the soloist depends on who is playing it, so on a piano trio it is the piano. Records where the part comes back empty are simply not dealt.",
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
    verifiedOnly: "Only play tracks with a confirmed start",
    volume: "Volume",
    reset: "Reset to defaults",
    close: "Close",
  },

  library: {
    title: "Library",
    intro:
      "Pick a record on the left, or add one. Adding fetches the whole recording once, you mark the tune and its solos on it, and the clips are cut when you are done.",
    unverified: "{n} unverified",
    allVerified: "Every timestamp confirmed.",
    filterAll: "All",
    filterUnverified: "Unverified",
    searchPlaceholder: "Search artist, tune, soloist…",
    showing: "{n} shown",
    noMatch: "Nothing matches “{query}”.",
    sortBy: "Sort",
    groupBy: "Group",
    sort: {
      catalog: "Catalogue",
      artist: "Artist",
      song: "Tune",
      year: "Year",
      soloist: "Soloist",
    },
    group: {
      none: "Flat",
      artist: "By artist",
      verified: "By state",
    },
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
    headClip: "The opening cut",
    soloClip: "The solo cut",
    spaceHint: "Space plays six seconds.",
    inClip: "In this clip",
    inSource: "In the source recording",
    preview: "Preview from here",
    stop: "Stop",
    markVerified: "Confirm timestamp",
    verified: "Confirmed",
    cutSoloClip: "Cut the solo clip",
    soloClipCut: "The hard levels open at {time}.",
    soloClipMissing:
      "No solo clip yet — the hard levels cannot deal this record at all until there is one.",
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

  /* The screen where a record is marked up. */
  mark: {
    add: "Add a record",
    addHelp:
      "Paste a link and the whole recording is fetched once. You then mark it end to end — the top of the tune, and every solo worth asking about — and only then is anything cut. Nothing is downloaded twice.",
    fetch: "Fetch the recording",
    fetching: "Fetching",
    fetchingHelp:
      "Downloading the tune and reading where the music starts. This is the only download.",
    cancel: "Never mind",
    start: "Top of the tune",
    startHelp:
      "Placed for you at the first sound. Move it only if the upload opens with applause or talk.",
    unnamed: "Unnamed solo",
    soloist: "Who is playing",
    note: "Note shown on reveal",
    addSolo: "+ Add a solo at the playhead",
    preview: "Play from the marker",
    keys: "Space plays from the selected marker until space stops it. ← → nudge it a tenth, with shift a second. Drag the lit box on the lower row to move the window.",
    details: "Album, year and the band — {n} credited",
    fixCredits: "Wrong, or nothing found?",
    fixCreditsHelp:
      "Paste a Discogs release and fetch it again. This overwrites the album, year and band shown above, even where they were already filled in.",
    save: "Cut and save",
    saveAndNext: "Save and take the next one",
    saving: "Cutting the clips",
    saveHelp: "Cuts the opening plus {n} solo clips, then throws the recording away.",
    discard: "Discard the recording",
    duplicate: "This one is already here",
    duplicateHelp:
      "Adding it again would leave two entries answering the same question with different clips. Open what is already there and mark that instead — the recording you just fetched is discarded either way.",
    openExisting: "Open what is already there",
    remark: "Mark it again",
    remarkHelp:
      "Fetches the recording once more and opens it with the positions you already have.",
    queue: "{n} still to mark",
    queueTitle: "From the playlist",
    queueHelp: "Marked one at a time. Skipping leaves a record out of the library entirely.",
    skip: "Skip this one",
    playlist: "Playlist link",
    playlistLoad: "List the playlist",
    playlistLoading: "Reading the playlist",
    playlistKnown: "{n} left out, already in the library",
    playlistAllKnown: "Every record in that playlist is already in the library.",
    playlistAuto: "Fetch them all without me",
    playlistAutoHelp:
      "Cuts the opening of every record and looks the details up, but marks no solos — nobody can hear where one enters without listening. Everything lands unverified, so you play the clips through afterwards and confirm them.",
    playlistFetchAll: "Fetch the playlist",
    tidal: "TIDAL artist link",
    tidalHelp:
      "Point it at a TIDAL artist and it lists what they recorded, drops anything already here, and finds each one on YouTube. A hit is only taken when its length matches what TIDAL says the record runs — so a live take, a cover or a whole album side is refused rather than guessed at. What comes back is a playlist like any other.",
    tidalLoad: "List the artist",
    tidalLoading: "Asking TIDAL",
    tidalMisses: "{n} could not be matched on YouTube and were left out.",

    autoTitle: "Fetching the playlist",
    autoHelp:
      "One at a time, so the count is real. Leave this open — it stops if you navigate away. Everything that lands is unverified and waiting in the list on the left.",
    autoProgress: "{done} of {n}",
    autoStop: "Stop after this one",
    autoDone: "Close",
    autoDuplicate: "Already in the library",
    autoFinished: "{n} added, all unverified. Play them through and confirm the ones that start in the right place.",
    auto: {
      waiting: "waiting",
      working: "fetching",
      added: "added",
      duplicate: "already here",
      skipped: "skipped",
      failed: "failed",
    },
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
    approve: "Mark it up",
    approving: "Downloading and cutting",
    reject: "Turn down",
    rejected: "Turned down",
    approved: "Added to the library",
    openVideo: "Watch on YouTube",
    tab: "Suggestions",
    tabLibrary: "Library",
  },

  /* The admin's side of a report — the review list. */
  reports: {
    tab: "Reports",
    title: "Reports",
    open: "{n} open",
    none: "Nothing open.",
    count: "reported {n} times",
    kind: {
      audio: "Audio",
      info: "Wrong info",
      other: "Other",
    },
    openRecord: "Open this record",
    resolve: "Mark resolved",
    resolving: "Saving",
    reopen: "Reopen",
  },

  a11y: {
    playButton: "Play the snippet",
    ladderStage: "Attempt {n}, {ms} of audio",
    closeDialog: "Close",
  },
} as const;

export type Dictionary = typeof en;
