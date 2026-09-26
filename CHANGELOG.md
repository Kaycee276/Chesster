# [1.21.0](https://github.com/Kaycee276/Chesster/compare/v1.20.0...v1.21.0) (2026-09-25)


### Features

* **frontend:** add right-click arrows and square highlights to the board ([23482a5](https://github.com/Kaycee276/Chesster/commit/23482a524797106a324bb80caca97d7ba830b6bc))

# [1.20.0](https://github.com/Kaycee276/Chesster/compare/v1.19.0...v1.20.0) (2026-09-25)


### Features

* harden chat and add tournament health coverage ([86b8634](https://github.com/Kaycee276/Chesster/commit/86b86341165a8f15b1bf09767ee1544daadf0abb))

# [1.19.0](https://github.com/Kaycee276/Chesster/compare/v1.18.0...v1.19.0) (2026-09-25)


### Features

* **frontend:** add network/offline connection alert banner ([86ea021](https://github.com/Kaycee276/Chesster/commit/86ea021c0077610379ee5a1666be91bffc59f52c)), closes [#256](https://github.com/Kaycee276/Chesster/issues/256)

# [1.18.0](https://github.com/Kaycee276/Chesster/compare/v1.17.0...v1.18.0) (2026-09-25)


### Features

* **backend:** add IP rate limiting for WebSocket handshakes ([25cd6c8](https://github.com/Kaycee276/Chesster/commit/25cd6c83383f2fc300031c6ba54722f7fdd7d240)), closes [#244](https://github.com/Kaycee276/Chesster/issues/244)
* **backend:** implement threefold repetition and 50-move draw detection ([8f87590](https://github.com/Kaycee276/Chesster/commit/8f87590b2c8c67956b62949eaf3396ab6d0dbb32)), closes [#242](https://github.com/Kaycee276/Chesster/issues/242)
* **frontend:** add PGN import and visual move replay analyzer ([9335a83](https://github.com/Kaycee276/Chesster/commit/9335a8358869e051ee92d8416de0e0323ddf1788))
* **frontend:** add post-game result modal with PGN copy, rematch and share ([47dfa08](https://github.com/Kaycee276/Chesster/commit/47dfa0862f640d1e747de2e4835d49e3918a38ae)), closes [#254](https://github.com/Kaycee276/Chesster/issues/254)

# [1.17.0](https://github.com/Kaycee276/Chesster/compare/v1.16.0...v1.17.0) (2026-09-25)


### Features

* add spectator reactions, themes, controls, and csrf ([7dd4527](https://github.com/Kaycee276/Chesster/commit/7dd4527b58147e74d21a8c680e287bdcc588af22))
* **frontend:** add low-time cue, autoplay unlock, and sound service tests ([7bfeda1](https://github.com/Kaycee276/Chesster/commit/7bfeda1f0fbd0c56183e6323d62972f793fe4996))
* **frontend:** add touch drag-and-drop piece movement with haptic feedback ([fb8db99](https://github.com/Kaycee276/Chesster/commit/fb8db997b82c67bb21562aa4627a487ac7d64896))

# [1.16.0](https://github.com/Kaycee276/Chesster/compare/v1.15.0...v1.16.0) (2026-09-24)


### Features

* **frontend:** build Tournament Hub screen with category filters and search ([#228](https://github.com/Kaycee276/Chesster/issues/228)) ([b83b330](https://github.com/Kaycee276/Chesster/commit/b83b330e8f32ce483b490864c0b16ab67154c1f0))

# [1.15.0](https://github.com/Kaycee276/Chesster/compare/v1.14.0...v1.15.0) (2026-09-24)


### Features

* **contracts:** Implement Batch Settlement Function for Concurrent Escrows ([516f067](https://github.com/Kaycee276/Chesster/commit/516f067e61e0ea003772db1a20078e319a528429)), closes [#236](https://github.com/Kaycee276/Chesster/issues/236)

# [1.14.0](https://github.com/Kaycee276/Chesster/compare/v1.13.0...v1.14.0) (2026-09-24)


### Features

* **tournament:** implement on-chain prize escrow, refund window, bracket seeding, and round advancement ([709f2fc](https://github.com/Kaycee276/Chesster/commit/709f2fcdf4a15c7f7a845e3b5e6b2dc8a8b9339d)), closes [#219](https://github.com/Kaycee276/Chesster/issues/219) [#220](https://github.com/Kaycee276/Chesster/issues/220) [#223](https://github.com/Kaycee276/Chesster/issues/223) [#224](https://github.com/Kaycee276/Chesster/issues/224)


### Performance Improvements

* **contracts:** optimize contract WASM size within 64 KB budget limit ([8e14730](https://github.com/Kaycee276/Chesster/commit/8e1473031ecd98a292ee3558fb3ab2ba12daa4d2))

# [1.13.0](https://github.com/Kaycee276/Chesster/compare/v1.12.0...v1.13.0) (2026-09-24)


### Features

* **backend,contracts:** match creation rate limiting, api docs, tournament rake, and disqualification slashing (closes [#151](https://github.com/Kaycee276/Chesster/issues/151), closes [#152](https://github.com/Kaycee276/Chesster/issues/152), closes [#221](https://github.com/Kaycee276/Chesster/issues/221), closes [#222](https://github.com/Kaycee276/Chesster/issues/222)) ([5ee7463](https://github.com/Kaycee276/Chesster/commit/5ee7463241d94d809d92824276a8c0e3cdaa4e6d))

# [1.12.0](https://github.com/Kaycee276/Chesster/compare/v1.11.0...v1.12.0) (2026-09-24)


### Features

* **database:** add tournament bracket and participant tables migration ([c902d26](https://github.com/Kaycee276/Chesster/commit/c902d2646daed783abd8d19d3efc736f11f20e78))

# [1.11.0](https://github.com/Kaycee276/Chesster/compare/v1.10.1...v1.11.0) (2026-09-23)


### Features

* implement contract storage TTL, allowance check, batch resolution, and theme mode ([79afb68](https://github.com/Kaycee276/Chesster/commit/79afb68966be423461f4ddf5848001784cc2c2d5)), closes [#29](https://github.com/Kaycee276/Chesster/issues/29) [#27](https://github.com/Kaycee276/Chesster/issues/27) [#25](https://github.com/Kaycee276/Chesster/issues/25) [#129](https://github.com/Kaycee276/Chesster/issues/129)

## [1.10.1](https://github.com/Kaycee276/Chesster/compare/v1.10.0...v1.10.1) (2026-09-16)


### Bug Fixes

* **database:** add existence checks for optional tables in RLS migration ([#137](https://github.com/Kaycee276/Chesster/issues/137)) ([8ee29b5](https://github.com/Kaycee276/Chesster/commit/8ee29b51e552152efa0f2a668cef684e1091a85a))

# [1.10.0](https://github.com/Kaycee276/Chesster/compare/v1.9.4...v1.10.0) (2026-09-16)


### Features

* **database:** implement Row-Level Security (RLS) policies for all Supabase tables ([#137](https://github.com/Kaycee276/Chesster/issues/137)) ([e860208](https://github.com/Kaycee276/Chesster/commit/e86020865e2ed8f493d03d71f67903745946b475))

## [1.9.4](https://github.com/Kaycee276/Chesster/compare/v1.9.3...v1.9.4) (2026-09-07)


### Bug Fixes

* resolve frontend/backend env validation and DB schema fallback for time control columns ([ff43083](https://github.com/Kaycee276/Chesster/commit/ff430839de28b409626af12cfb93029a906683c7))

## [1.9.3](https://github.com/Kaycee276/Chesster/compare/v1.9.2...v1.9.3) (2026-09-07)


### Bug Fixes

* **frontend:** remove leave game button while waiting for opponent ([601e34a](https://github.com/Kaycee276/Chesster/commit/601e34a75ec967b66afd4991c0951736647d0c3e))

## [1.9.2](https://github.com/Kaycee276/Chesster/compare/v1.9.1...v1.9.2) (2026-09-06)


### Bug Fixes

* **backend:** validate coordinator secret key gracefully and support env alias fallback keys ([cfa57d3](https://github.com/Kaycee276/Chesster/commit/cfa57d3d3da3dc160d08b71ef989cfafb87b5214))

## [1.9.1](https://github.com/Kaycee276/Chesster/compare/v1.9.0...v1.9.1) (2026-09-06)


### Bug Fixes

* **contracts:** fix clippy len_zero warning in test.rs ([90c2354](https://github.com/Kaycee276/Chesster/commit/90c235493bb3786a5957d9e7f5ca273331bf93cd))

# [1.9.0](https://github.com/Kaycee276/Chesster/compare/v1.8.0...v1.9.0) (2026-09-06)


### Bug Fixes

* **ci:** refresh backend lockfile ([41de40b](https://github.com/Kaycee276/Chesster/commit/41de40bb0e96bb7426663aa5d2aa6e18687bc1f5))
* **database:** add indexes for game and move queries ([6b76cea](https://github.com/Kaycee276/Chesster/commit/6b76ceaeb46b1e0fa9e8ec62a7fe9cc0e5656898))
* resolve smart contract compilation errors, frontend TS build, and test suite configs ([6e83092](https://github.com/Kaycee276/Chesster/commit/6e83092faa04528fb9bce38f4e65b0364eb3bb23))
* stabilize backend CI test environment ([5f306c8](https://github.com/Kaycee276/Chesster/commit/5f306c8d1a6fda90dca44151feeb664b7c44e3da))
* stabilize backend CI test environment ([42d5860](https://github.com/Kaycee276/Chesster/commit/42d58602f7bd9842b105bab003568f55867f8909))


### Features

* add configurable regional wager blocking ([eadb5c0](https://github.com/Kaycee276/Chesster/commit/eadb5c0c7cf97db4ac8d16a9041e3892390f3373))
* add escrow unresolved-match fallback ([883b464](https://github.com/Kaycee276/Chesster/commit/883b4648fafd8b4e6551cf680487f9388e8139a2))
* anti-cheat telemetry, helmet CORS/CSP, touch gestures, animation improvements ([f73de28](https://github.com/Kaycee276/Chesster/commit/f73de28185075b66218c954419a2ac5b0955aca8)), closes [#105](https://github.com/Kaycee276/Chesster/issues/105) [#106](https://github.com/Kaycee276/Chesster/issues/106) [#116](https://github.com/Kaycee276/Chesster/issues/116) [#120](https://github.com/Kaycee276/Chesster/issues/120)
* **backend:** enable websocket per-message deflate ([b6e68db](https://github.com/Kaycee276/Chesster/commit/b6e68db91eafb251114e6c2300ab256b831cb628))
* **contracts:** add emergency pause circuit breaker (issue [#22](https://github.com/Kaycee276/Chesster/issues/22)) ([910a11f](https://github.com/Kaycee276/Chesster/commit/910a11ff5ce0c9423ab607eb6bcc321ec5e1bbb4))
* **contracts:** Add match cancellation and cooperative mutual draw resolution ([#20](https://github.com/Kaycee276/Chesster/issues/20)) ([b9118cb](https://github.com/Kaycee276/Chesster/commit/b9118cba9c68ecf89ee48f5b9ab8c00d278ea1fe))
* **contracts:** Escrow security hardening — coordinator rotation, reentrancy guard, balance invariants, upgradeability ([03f1eab](https://github.com/Kaycee276/Chesster/commit/03f1eab8985b7f68dc0761fe447cef05377e4e3b)), closes [#100](https://github.com/Kaycee276/Chesster/issues/100) [#103](https://github.com/Kaycee276/Chesster/issues/103) [#104](https://github.com/Kaycee276/Chesster/issues/104) [#102](https://github.com/Kaycee276/Chesster/issues/102) [#100](https://github.com/Kaycee276/Chesster/issues/100) [#102](https://github.com/Kaycee276/Chesster/issues/102) [#103](https://github.com/Kaycee276/Chesster/issues/103) [#104](https://github.com/Kaycee276/Chesster/issues/104)
* **contracts:** Implement Dynamic Wager Scaling with Configurable Minimum & Maximum Limits ([c5d44b6](https://github.com/Kaycee276/Chesster/commit/c5d44b6e7275a0d97a7b295ad10d96d95ac334af)), closes [#23](https://github.com/Kaycee276/Chesster/issues/23)
* **contracts:** implement match expiration & auto-claim refund timeout logic ([e391bc5](https://github.com/Kaycee276/Chesster/commit/e391bc55195d745db3da1c5521eb60bb6f0fcaba)), closes [#19](https://github.com/Kaycee276/Chesster/issues/19) [#21](https://github.com/Kaycee276/Chesster/issues/21)
* **contracts:** Implement platform fee tiering and treasury vault configuration ([#19](https://github.com/Kaycee276/Chesster/issues/19)) ([b9db53c](https://github.com/Kaycee276/Chesster/commit/b9db53c606d4dc53d0f9e360c5b0179397b66ad7))
* **frontend:** add customizable piece sets and board flip toggle ([#125](https://github.com/Kaycee276/Chesster/issues/125), [#128](https://github.com/Kaycee276/Chesster/issues/128)) ([7eb1c0f](https://github.com/Kaycee276/Chesster/commit/7eb1c0f597dc163e2a79a90a50fc5e98bc4b2c4a))
* **frontend:** add in-app notification toast system for game invitations ([#126](https://github.com/Kaycee276/Chesster/issues/126)) ([bb9b515](https://github.com/Kaycee276/Chesster/commit/bb9b515ddc72cdf1b916b619e3de39ede5d3a765))
* **frontend:** add live game spectator mode with evaluation bar ([#127](https://github.com/Kaycee276/Chesster/issues/127)) ([3016823](https://github.com/Kaycee276/Chesster/commit/30168231d922694287def19f624fc660a554ed79))
* **frontend:** game playback rewind, material display, move indicators, fullscreen ([37f1312](https://github.com/Kaycee276/Chesster/commit/37f13121e26348fabc120b1ec54a14e6cfb817e8)), closes [#124](https://github.com/Kaycee276/Chesster/issues/124) [#123](https://github.com/Kaycee276/Chesster/issues/123) [#112](https://github.com/Kaycee276/Chesster/issues/112) [#109](https://github.com/Kaycee276/Chesster/issues/109)
* **frontend:** volume control, PGN/FEN export, multi-wallet, ESLint fixes ([bf7d586](https://github.com/Kaycee276/Chesster/commit/bf7d5869cd08e672b2b759892f63027cc39ec005)), closes [#107](https://github.com/Kaycee276/Chesster/issues/107) [#108](https://github.com/Kaycee276/Chesster/issues/108) [#110](https://github.com/Kaycee276/Chesster/issues/110) [#111](https://github.com/Kaycee276/Chesster/issues/111)
* moderate player chat messages ([02bc34a](https://github.com/Kaycee276/Chesster/commit/02bc34a2b9d15a52a338af62204f47f1acd575bc))

# [1.8.0](https://github.com/Kaycee276/Chesster/compare/v1.7.0...v1.8.0) (2026-08-26)


### Bug Fixes

* **database:** drop end_reason from seed (column not in canonical schema) ([c39d4c2](https://github.com/Kaycee276/Chesster/commit/c39d4c2bcabfd6aa74b8454080991fea1c73c625))
* **database:** sync package-lock with pg dependency ([7abc974](https://github.com/Kaycee276/Chesster/commit/7abc974180e5e938fff854711cb92886a0c0c4fa))


### Features

* **contracts:** Implement On-Chain Player Elo Rating Ledger Proof ([93d6acb](https://github.com/Kaycee276/Chesster/commit/93d6acba0b0e3224d05afa6f3c5c053553b1e383))
* **database:** add automated encrypted PostgreSQL backup & snapshot script ([3d93bf3](https://github.com/Kaycee276/Chesster/commit/3d93bf317bfbd291fb72ac7035f1256b0b3445f9)), closes [#119](https://github.com/Kaycee276/Chesster/issues/119)
* **database:** add idempotent seed data script for local dev & E2E ([8d7dab4](https://github.com/Kaycee276/Chesster/commit/8d7dab463dd2cc8c3a0b13d0e8f42dd4559b5973)), closes [#117](https://github.com/Kaycee276/Chesster/issues/117)
* **database:** add migration runner script with rollback support ([69dc8fa](https://github.com/Kaycee276/Chesster/commit/69dc8fa81716ab9db9174afab3fcf3458be6f719)), closes [#80](https://github.com/Kaycee276/Chesster/issues/80)
* **database:** partition games table by month on created_at (012) ([cc63e5a](https://github.com/Kaycee276/Chesster/commit/cc63e5ae83135d5a41b35b2098ba4033af287903)), closes [#118](https://github.com/Kaycee276/Chesster/issues/118)
* **frontend:** add customizable board themes (Wood, Neon, Classic, Marble) ([bca8b13](https://github.com/Kaycee276/Chesster/commit/bca8b1303e1a7ada5152d3016f159fdfaa7fc28b)), closes [#82](https://github.com/Kaycee276/Chesster/issues/82)

# [1.7.0](https://github.com/Kaycee276/Chesster/compare/v1.6.0...v1.7.0) (2026-08-26)


### Features

* **database:** add token wager transaction ledger table migration ([#79](https://github.com/Kaycee276/Chesster/issues/79)) ([d2e0c74](https://github.com/Kaycee276/Chesster/commit/d2e0c74972c0c1a45fde3947ac412f42aff503a5))

# [1.6.0](https://github.com/Kaycee276/Chesster/compare/v1.5.0...v1.6.0) (2026-08-25)


### Features

* add escrow retries whitelist and events ([c3edf69](https://github.com/Kaycee276/Chesster/commit/c3edf691b5629ebea7d0020c6767903e2d226260))
* **backend:** add daily active player and match volume aggregation service ([#69](https://github.com/Kaycee276/Chesster/issues/69)) ([8a7de90](https://github.com/Kaycee276/Chesster/commit/8a7de9056a3d5f7b393ddef6f89afedc8ee81fc8))
* **backend:** add global exception handling & Sentry error reporting middleware ([#61](https://github.com/Kaycee276/Chesster/issues/61)) ([01ac707](https://github.com/Kaycee276/Chesster/commit/01ac707ebeadc574dfb1d800bbba887aa1f9ddfa))
* **backend:** implement Elo rating update calculation service ([#66](https://github.com/Kaycee276/Chesster/issues/66)) ([01c966f](https://github.com/Kaycee276/Chesster/commit/01c966fc6553eaf72dbb25705cb0a9fa6ffe28fb))
* **backend:** Implement Matchmaking Queue with Elo-Based Rating Pairings ([4e784a8](https://github.com/Kaycee276/Chesster/commit/4e784a8cb0d42c895eb202367e5886780a1b81fd))
* **contracts:** Add Comprehensive Rustdoc Comments, Stale Match GC, and Native XLM Utilities ([2f2fd6c](https://github.com/Kaycee276/Chesster/commit/2f2fd6c5a38008459eebadf428d650e6f112dc51))
* **database:** add move history JSONB schema validation constraint ([#77](https://github.com/Kaycee276/Chesster/issues/77)) ([bb252f6](https://github.com/Kaycee276/Chesster/commit/bb252f6d1a46b1b2b5e9bfe8c786f4e26dcbfc73))
* **database:** add player match statistics aggregation trigger ([#76](https://github.com/Kaycee276/Chesster/issues/76)) ([6a745d8](https://github.com/Kaycee276/Chesster/commit/6a745d854caa09be8f5d9529ce26193645d4b222))
* **database:** add soft delete and archival partitioning migration ([#74](https://github.com/Kaycee276/Chesster/issues/74)) ([2737e83](https://github.com/Kaycee276/Chesster/commit/2737e8351c43851bca1b2a1e47cb4d955c3d96d7))
* **database:** implement match_audit_logs table for dispute resolution ([96cfa54](https://github.com/Kaycee276/Chesster/commit/96cfa54816795c760fd665d0f71ef660cd9684ea)), closes [#73](https://github.com/Kaycee276/Chesster/issues/73)

# [1.5.0](https://github.com/Kaycee276/Chesster/compare/v1.4.0...v1.5.0) (2026-08-25)


### Features

* **backend:** Add structured logging, health checks, PGN/FEN support, and Stellar indexer ([c5cfa80](https://github.com/Kaycee276/Chesster/commit/c5cfa80778f36852e50dc0f9cb5fc4e1948cc0a1))
* **backend:** implement webhook notification service for match payout confirmations ([918336a](https://github.com/Kaycee276/Chesster/commit/918336a25ec4a04dd31d937d0fc4469a0b92de61)), closes [#48](https://github.com/Kaycee276/Chesster/issues/48) [#49](https://github.com/Kaycee276/Chesster/issues/49) [#50](https://github.com/Kaycee276/Chesster/issues/50) [#51](https://github.com/Kaycee276/Chesster/issues/51)
* **contracts:** Support Multi-Token Wagers in Soroban Escrow ([0b46b92](https://github.com/Kaycee276/Chesster/commit/0b46b924fb273783ffa2265b5e348800e7526ec7))

# [1.4.0](https://github.com/Kaycee276/Chesster/compare/v1.3.0...v1.4.0) (2026-08-25)


### Features

* **backend:** Implement move validation cache, cron cleanup, paginated history, and undo protocol ([18c7696](https://github.com/Kaycee276/Chesster/commit/18c7696965358a3b01e4faf3aa2331b3d19fec7c)), closes [#60](https://github.com/Kaycee276/Chesster/issues/60) [#59](https://github.com/Kaycee276/Chesster/issues/59) [#58](https://github.com/Kaycee276/Chesster/issues/58) [#54](https://github.com/Kaycee276/Chesster/issues/54) [#60](https://github.com/Kaycee276/Chesster/issues/60) [#59](https://github.com/Kaycee276/Chesster/issues/59) [#58](https://github.com/Kaycee276/Chesster/issues/58) [#54](https://github.com/Kaycee276/Chesster/issues/54)

# [1.3.0](https://github.com/Kaycee276/Chesster/compare/v1.2.0...v1.3.0) (2026-08-24)


### Features

* **contracts:** add storage TTL auto-extension, allowance checks, dispute time-lock, and batch resolution ([807a876](https://github.com/Kaycee276/Chesster/commit/807a8769a1bca8a5e4b6d642afe41eb2843d13b9))

# [1.2.0](https://github.com/Kaycee276/Chesster/compare/v1.1.0...v1.2.0) (2026-08-24)


### Features

* **backend:** add JWT authentication middleware for profile customization ([0029b98](https://github.com/Kaycee276/Chesster/commit/0029b981153d48bc06f36b8df4f8f4f4a6143687))
* **backend:** add Stockfish AI bot opponent endpoint for single player ([7b2fc89](https://github.com/Kaycee276/Chesster/commit/7b2fc897b3fb5ba1dc09a0b6b4727029f8f72e6e))
* **backend:** Socket.io reconnect grace period + per-player clock increments ([6de060d](https://github.com/Kaycee276/Chesster/commit/6de060d2a516f26b51796569e3c0f9a7239a13ff)), closes [#43](https://github.com/Kaycee276/Chesster/issues/43) [#45](https://github.com/Kaycee276/Chesster/issues/45)

# [1.1.0](https://github.com/Kaycee276/Chesster/compare/v1.0.1...v1.1.0) (2026-08-24)


### Bug Fixes

* **escrow:** resolve clippy bool_assert_comparison warning in test.rs ([e3e5227](https://github.com/Kaycee276/Chesster/commit/e3e5227855f2554072a0ae96737a198dde03de9e))


### Features

* **contracts:** Add comprehensive escrow enhancements ([6f6c89f](https://github.com/Kaycee276/Chesster/commit/6f6c89f0830d81d4240fd52ff70fabc72923a48d)), closes [#33](https://github.com/Kaycee276/Chesster/issues/33) [#32](https://github.com/Kaycee276/Chesster/issues/32) [#31](https://github.com/Kaycee276/Chesster/issues/31) [#30](https://github.com/Kaycee276/Chesster/issues/30)
* **contracts:** implement match nonce, side betting pool, fee discount, and mutual cancellation ([d1b1e5a](https://github.com/Kaycee276/Chesster/commit/d1b1e5a2d4aa2a513a4774aa6456c0312e28337b)), closes [#34](https://github.com/Kaycee276/Chesster/issues/34) [#35](https://github.com/Kaycee276/Chesster/issues/35) [#36](https://github.com/Kaycee276/Chesster/issues/36) [#37](https://github.com/Kaycee276/Chesster/issues/37)

## [1.0.1](https://github.com/Kaycee276/Chesster/compare/v1.0.0...v1.0.1) (2026-08-24)


### Bug Fixes

* **frontend:** resolve ESLint errors and Vitest config type overload ([ca643d9](https://github.com/Kaycee276/Chesster/commit/ca643d91414696c57dfe69c20fa72fade005ff18))

# 1.0.0 (2026-08-24)


### Bug Fixes

* fix payout model ([b553e28](https://github.com/Kaycee276/Chesster/commit/b553e28575e8b6c44d542525b25faa7b8365fa57))

# Changelog

All notable changes to **Chesster** will be automatically documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
