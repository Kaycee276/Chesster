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
