# Graph Report - .  (2026-09-06)

## Corpus Check
- 18 files · ~102,697 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 812 nodes · 2047 edges · 38 communities (32 shown, 6 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 11 edges (avg confidence: 0.66)
- Token cost: 1,226 input · 492 output

## Community Hubs (Navigation)
- Tidal Integration
- Game Board UI
- Guess Field & Name Cleaning
- Audio Serving Routes
- Last.fm Integration
- Project Dependencies
- Admin Inspect/Auto Routes
- Fetch-Missing Pipeline
- Admin Page & Reports API
- TypeScript/Next Config Types
- Stem Separation (Demucs)
- Discogs Credits
- Suggestions & Soloist Normalization
- Login & Band Progress UI
- Solos Admin API (CRUD)
- Library List UI
- Overlay/Report/Stats Panels
- Root Layout
- Library Admin UI
- Source Workbench UI
- Choice Field & Daily Puzzle
- Solo Editor UI
- Artist Neighbours Script
- i18n Dictionary
- Suggest Page UI
- ForYou Session UI
- Cut Solo Clips Script
- Discogs Types
- Extract Types
- Agent Docs & Server Specs
- Entrypoint Script
- ESLint Config
- Next Config
- PostCSS Config
- Last.fm Logo Asset
- Tidal Wordmark Asset

## God Nodes (most connected - your core abstractions)
1. `t()` - 41 edges
2. `checkTools()` - 32 edges
3. `requireAdmin()` - 30 edges
4. `Solo` - 29 edges
5. `readLibrary()` - 26 edges
6. `loadSolos()` - 25 edges
7. `cleanName()` - 19 edges
8. `take()` - 19 edges
9. `callerKey()` - 18 edges
10. `inspectSource()` - 17 edges

## Surprising Connections (you probably didn't know these)
- `fromNearby()` --indirect_call--> `track()`  [INFERRED]
  app/api/foryou/lastfm/route.ts → lib/analytics.ts
- `Draft` --references--> `Credit`  [EXTRACTED]
  components/SuggestForm.tsx → lib/types.ts
- `SoloEditorProps` --references--> `Solo`  [EXTRACTED]
  components/admin/SoloEditor.tsx → lib/types.ts
- `StoredSession` --references--> `Solo`  [EXTRACTED]
  components/ForYou.tsx → lib/types.ts
- `AdminPage()` --calls--> `loadSolos()`  [EXTRACTED]
  app/admin/page.tsx → lib/library.ts

## Import Cycles
- None detected.

## Communities (38 total, 6 thin omitted)

### Community 0 - "Tidal Integration"
Cohesion: 0.05
Nodes (77): dynamic, maxDuration, POST(), dynamic, maxDuration, POST(), dynamic, google (+69 more)

### Community 1 - "Game Board UI"
Cohesion: 0.06
Nodes (64): Board(), BoardProps, FIELDS, Game(), Mode, nearFor(), LevelPicker(), LevelPickerProps (+56 more)

### Community 2 - "Guess Field & Name Cleaning"
Cohesion: 0.07
Nodes (55): GuessField(), GuessFieldProps, cleanName(), cleanRecord(), tidy(), artistKey(), CANONICAL, fold() (+47 more)

### Community 3 - "Audio Serving Routes"
Cohesion: 0.07
Nodes (47): GET(), GET(), NOT_FOUND(), dynamic, GET(), Draft, dynamic, mapLimit() (+39 more)

### Community 4 - "Last.fm Integration"
Cohesion: 0.09
Nodes (40): dynamic, fromNearby(), fromPlayed(), maxDuration, missing(), Mode, POST(), silent() (+32 more)

### Community 5 - "Project Dependencies"
Cohesion: 0.04
Nodes (44): ai, @ai-sdk/google, eslint, eslint-config-next, next, dependencies, ai, @ai-sdk/google (+36 more)

### Community 6 - "Admin Inspect/Auto Routes"
Cohesion: 0.11
Nodes (32): dynamic, maxDuration, POST(), dynamic, maxDuration, POST(), dynamic, maxDuration (+24 more)

### Community 7 - "Fetch-Missing Pipeline"
Cohesion: 0.12
Nodes (34): dynamic, maxDuration, POST(), applyClipToLibrary(), audioTargets(), CLIENT_FALLBACKS, CLIP_LENGTH, cutFromSource() (+26 more)

### Community 8 - "Admin Page & Reports API"
Cohesion: 0.12
Nodes (29): AdminPage(), dynamic, dynamic, GET(), PATCH(), dynamic, POST(), dynamic (+21 more)

### Community 9 - "TypeScript/Next Config Types"
Cohesion: 0.07
Nodes (28): dom, dom.iterable, esnext, **/*.mts, .next/dev/types/**/*.ts, next-env.d.ts, .next/types/**/*.ts, node_modules (+20 more)

### Community 10 - "Stem Separation (Demucs)"
Cohesion: 0.11
Nodes (25): BASS_FALLBACK_MODELS, DEMUCS, encodeStem(), ensureSeparator(), HEAD_BY_INSTRUMENT, judgeStem(), leadStemFor(), measuredLift() (+17 more)

### Community 11 - "Discogs Credits"
Cohesion: 0.18
Nodes (23): dynamic, maxDuration, POST(), albumMatches(), bestOf(), BILLING_SCORE, billingMatch(), billingOf() (+15 more)

### Community 12 - "Suggestions & Soloist Normalization"
Cohesion: 0.20
Nodes (17): dynamic, maxDuration, PATCH(), normalize(), resolveSoloist(), main(), parseArgs(), formatTimecode() (+9 more)

### Community 13 - "Login & Band Progress UI"
Cohesion: 0.19
Nodes (15): LoginForm(), bandProgress(), BandStrip(), BandStripProps, PlayControl(), PlayControlProps, Result(), Sleeve() (+7 more)

### Community 14 - "Solos Admin API (CRUD)"
Cohesion: 0.21
Nodes (14): DELETE(), dynamic, GET(), PATCH(), unresolved, write, AUDIO_DIR, looksLikeAnOnset() (+6 more)

### Community 15 - "Library List UI"
Cohesion: 0.16
Nodes (16): compare(), Group, groupByTune(), GROUPS, haystack(), LibraryList(), LibraryListProps, normalize() (+8 more)

### Community 16 - "Overlay/Report/Stats Panels"
Cohesion: 0.16
Nodes (12): Overlay(), KINDS, ReportPanel(), StatsPanel(), StatsPanelProps, ReportKind, ReportStatus, RoundStatus (+4 more)

### Community 17 - "Root Layout"
Cohesion: 0.17
Nodes (11): archivo, metadata, plexMono, viewport, Analytics(), EventData, track(), UMAMI_DOMAINS (+3 more)

### Community 18 - "Library Admin UI"
Cohesion: 0.21
Nodes (12): AutoResult, Job, LibraryAdmin(), PlaylistEntry, ReportsReview(), ReportsReviewProps, when(), SuggestionReview() (+4 more)

### Community 19 - "Source Workbench UI"
Cohesion: 0.21
Nodes (12): Mark, PREVIEW_LENGTHS, Row(), timecode(), drawWave(), peaksOver(), timecode(), TrackMark (+4 more)

### Community 20 - "Choice Field & Daily Puzzle"
Cohesion: 0.26
Nodes (12): ChoiceField(), ChoiceFieldProps, answerKey(), daysSinceEpoch(), EPOCH, nearestFreeSlot(), pickDaily(), pickSequential() (+4 more)

### Community 21 - "Solo Editor UI"
Cohesion: 0.23
Nodes (9): PREVIEW_LENGTHS, rmsAfter(), SoloEditor(), SoloEditorProps, timecode(), SourceWorkbench(), Waveform(), WaveformProps (+1 more)

### Community 22 - "Artist Neighbours Script"
Cohesion: 0.18
Nodes (7): artists, body, inLexicon, lines, map, sizes, source

### Community 23 - "i18n Dictionary"
Cohesion: 0.27
Nodes (8): Dictionary, en, DEFAULT_LOCALE, DICTIONARIES, Locale, MessageKey, Path, resolve()

### Community 24 - "Suggest Page UI"
Cohesion: 0.25
Nodes (5): dynamic, Batch, Draft, KNOWN_ERRORS, SuggestForm()

### Community 25 - "ForYou Session UI"
Cohesion: 0.29
Nodes (3): Phase, StoredSession, SiteHeader()

### Community 26 - "Cut Solo Clips Script"
Cohesion: 0.40
Nodes (4): args, force, missing, targets

### Community 27 - "Discogs Types"
Cohesion: 0.50
Nodes (3): Billing, DiscogsCredit, DiscogsRelease

### Community 28 - "Extract Types"
Cohesion: 0.50
Nodes (3): AudioTarget, CutClip, PlaylistEntry

### Community 29 - "Agent Docs & Server Specs"
Cohesion: 0.67
Nodes (3): Next.js Agent Rules, leosrv Server Specifications, Next.js Documentation

## Knowledge Gaps
- **218 isolated node(s):** `dynamic`, `dynamic`, `maxDuration`, `dynamic`, `maxDuration` (+213 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Solo` connect `Library List UI` to `Tidal Integration`, `Game Board UI`, `Audio Serving Routes`, `Admin Inspect/Auto Routes`, `Fetch-Missing Pipeline`, `Suggestions & Soloist Normalization`, `Login & Band Progress UI`, `Solos Admin API (CRUD)`, `Overlay/Report/Stats Panels`, `Library Admin UI`, `Source Workbench UI`, `Choice Field & Daily Puzzle`, `Solo Editor UI`, `ForYou Session UI`?**
  _High betweenness centrality (0.056) - this node is a cross-community bridge._
- **Why does `track()` connect `Root Layout` to `Tidal Integration`, `Last.fm Integration`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **Why does `loadSolos()` connect `Audio Serving Routes` to `Admin Page & Reports API`, `Tidal Integration`, `Last.fm Integration`, `Admin Inspect/Auto Routes`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **What connects `dynamic`, `dynamic`, `maxDuration` to the rest of the system?**
  _218 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Tidal Integration` be split into smaller, more focused modules?**
  _Cohesion score 0.05103785103785104 - nodes in this community are weakly interconnected._
- **Should `Game Board UI` be split into smaller, more focused modules?**
  _Cohesion score 0.062456140350877196 - nodes in this community are weakly interconnected._
- **Should `Guess Field & Name Cleaning` be split into smaller, more focused modules?**
  _Cohesion score 0.06538461538461539 - nodes in this community are weakly interconnected._