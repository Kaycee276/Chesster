# Chesster Tournament System - Architectural Plan & Issue Generation Roadmap

This document outlines the complete architectural design and issue roadmap for the **Chesster Tournament System** built on Stellar / Soroban.

---

## 🏗️ Architecture Overview

The tournament system is designed to support single-elimination and Swiss-system online chess tournaments with automated on-chain prize pool escrow handling.

```
┌─────────────────────────────────────────────────────────────────┐
│                      Frontend (React + Vite)                    │
│  Tournament Hub  │  Interactive Bracket  │  Live Match Queue    │
└────────────────────────────────┬────────────────────────────────┘
                                 │ REST + Socket.io Events
┌────────────────────────────────▼────────────────────────────────┐
│                   Backend (Express + Socket.io)                 │
│  Tournament Controller │ Service (Bracket Engine) │ DB Model    │
└────────────────────────────────┬────────────────────────────────┘
                                 │ Soroban SDK & Horizon RPC
┌────────────────────────────────▼────────────────────────────────┐
│               Smart Contracts (Stellar / Soroban)               │
│  create_tournament  │  join_tournament  │  complete_tournament  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📜 Core Technical Specifications

### 1. Smart Contract Escrow (`contracts/soroban/contracts/escrow/src/lib.rs`)
- `create_tournament(env, tournament_id, entry_fee, max_players, token)`: Initializes an on-chain prize pool.
- `join_tournament(env, tournament_id, player)`: Transfers entry fee into escrow and registers player.
- `complete_tournament(env, tournament_id, winners_list, payouts)`: Atomically distributes escrowed prize pool to winners.
- `cancel_tournament(env, tournament_id)`: Enables refund window if minimum participants are not met.

### 2. Database Schema (`backend/database/migrations/010_create_tournaments_schema.sql`)
- `tournaments`: ID, title, entry_fee, max_players, status (`open`, `active`, `completed`, `cancelled`), current_round, winner_address.
- `tournament_participants`: tournament_id, wallet_address, seed_number, status.
- `bracket_matches`: tournament_id, round, match_number, player_white, player_black, game_code, winner, status.

### 3. Backend Service Engine (`backend/services/tournamentService.js`)
- **Seeding Algorithm**: Standard single-elimination bracket generation (#1 vs #8, #2 vs #7).
- **Match Auto-Creation**: Instantiates game rooms via `gameModel.createGame` as rounds advance.
- **Round Advancement**: Listens for game end events, updates `bracket_matches`, and pairs winners for the next round.
- **On-Chain Payout Trigger**: Calls Soroban `complete_tournament` when the final match finishes.

### 4. Real-Time Socket.io Lifecycle
- `tournament:player_joined`: Broadcasts updated registration count.
- `tournament:bracket_generated`: Broadcasts initial round bracket.
- `tournament:match_ready`: Notifies paired players that their game server is ready.
- `tournament:match_completed`: Updates live bracket tree.
- `tournament:completed`: Broadcasts final podium and on-chain payout transaction hash.

### 5. Frontend UI/UX (`frontend/src/`)
- `TournamentPage.tsx`: Tournament hub displaying open, active, and past events.
- `TournamentBracket.tsx`: Interactive tree diagram showing live matches and "Spectate" links.
- `TournamentQueueModal.tsx`: Pop-up prompting paired players when their match is ready.
- `TournamentPodium.tsx`: Victory summary with champion highlights and prize payout details.

---

## 📋 Issue Creation Roadmap for `osswc-issues-gen`

Whenever `osswc-issues-gen` (or issue generation) runs, prioritize:

1. **Step 1: Audit & Complete Open Project Issues**:
   - Audit remaining open security, testing, database (RLS), and frontend issues first.

2. **Step 2: Generate Tournament System Issues Series**:

| Issue Title | Domain | Difficulty | Target Delivery |
|---|---|---|---|
| `[CONTRACTS] feat(contracts): Integrate Soroban Multi-Winner Prize Distribution in complete_tournament` | Contracts | Hard | 5-7 Days |
| `[CONTRACTS] feat(contracts): Add Tournament Entry Fee Refund Window & Minimum Player Threshold Safeguard` | Contracts | Medium | 3-5 Days |
| `[BACKEND] feat(backend): Implement Tournament Service Bracket Generation & Seeding Algorithm` | Backend | Hard | 5-7 Days |
| `[BACKEND] feat(backend): Implement Automated Round Advancement Engine & Match Room Instantiation` | Backend | Hard | 5-7 Days |
| `[BACKEND] feat(backend): Create Tournament REST API Endpoints (List, Details, Register, Brackets)` | Backend | Medium | 3-5 Days |
| `[BACKEND] feat(backend): Implement Socket.io Tournament Real-Time Events & Live Match Queue Broadcasts` | Backend | Medium | 3-5 Days |
| `[FRONTEND] feat(frontend): Implement Tournament Hub Screen with Active, Open & Past Filters` | Frontend | Medium | 3-5 Days |
| `[FRONTEND] feat(frontend): Create Interactive Tree Tournament Bracket Component with Live Match Links` | Frontend | Hard | 5-7 Days |
| `[FRONTEND] feat(frontend): Add Tournament Match Ready Queue Pop-up Modal & Auto-Redirect` | Frontend | Easy | 1-2 Days |
| `[FRONTEND] feat(frontend): Build Post-Tournament Winner Podium Summary & On-Chain Payout Link Display` | Frontend | Easy | 1-2 Days |
| `[TESTING] test(backend): Integration Tests for Tournament Bracket Advancement & Round Transitions` | Testing | Medium | 3-5 Days |
| `[TESTING] test(contracts): Unit Tests for Tournament Escrow Pool Storage and Payout Calculations` | Testing | Medium | 3-5 Days |
