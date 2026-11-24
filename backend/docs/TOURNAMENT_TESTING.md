# Tournament lifecycle coverage

`tests/tournamentLifecycle.test.js` runs the production tournament registration
and bracket HTTP handlers against an in-memory storage boundary. It drives the
real Swiss pairing and tiebreak functions across a four-player, two-round
scenario, and verifies tournament event delivery to four real Socket.IO clients.
Room acknowledgements and bounded event waits replace timing sleeps. Every
client and server is closed after each scenario.

A separate scenario runs the existing single-elimination advancement service
through both semifinals and the final. It checks final-game creation and the
escrow request for one winner with 10,000 basis points. Database operations,
wallet cryptography, and on-chain settlement are fixtures; ledger transfers,
actual buy-in deposits, and production authentication are outside these tests.

`frontend/e2e/tournamentLifecycle.spec.ts` opens four independent browser
contexts, checks round-one bracket rendering, follows a live-game spectator
link, renders winners paired in a round-two snapshot, and checks the ready
modal and final snapshot. API interception supplies snapshots using production `match_number` and
`in_progress` fields. The tournament API boundary adapts those to the page
contract so live links and numbered labels work with actual backend responses.
`frontend/src/api/tournamentApi.test.ts` also checks legacy envelopes and
immutable normalization. This is
browser rendering coverage rather than a browser-to-production Swiss lifecycle.
`.github/workflows/tournament-tests.yml` runs this browser contract in Chromium;
the existing backend CI discovers the backend integration and adapter tests.

## Remaining prerequisite for a complete Swiss E2E

The production tournament router currently exposes list, detail, bracket,
export, and registration endpoints. It does not expose tournament creation,
Swiss start/round advancement, score-result submission, or Swiss completion.
`generateSwissRoundPairings` returns pairings without persisting matches,
starting games, updating scores, or settling the tournament. The single-
elimination advancement method must not be used to settle each Swiss match as
though it were the final.

A complete browser-to-production test for issue #765 therefore still requires
an authorized Swiss coordinator, its authenticated API/events, and an escrow
fixture boundary. The current contribution does not claim to fulfill those
missing acceptance criteria. It adds coverage for the available production
behavior and fixes three missing model methods used by registration/details,
plus the bracket-match data needed by the existing bracket page.

## Validation

The contribution was reviewed statically under the drips workflow. No local
project test, build, package-manager, or installation command was run. The test
suites execute in repository CI after publication.
