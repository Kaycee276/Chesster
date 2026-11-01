# Soroban Escrow Integration Guide

This guide is the developer-facing reference for the `ChessterEscrow` Soroban contract in
[`contracts/soroban/contracts/escrow/src/lib.rs`](../contracts/soroban/contracts/escrow/src/lib.rs):
how its storage is laid out, what each custom error means, how token amounts are represented,
and how to stand up a local Soroban network for backend development without depending on
public Testnet uptime. For component responsibilities and the high-level match lifecycle, start
with [`ARCHITECTURE.md`](./ARCHITECTURE.md); this document goes one level deeper into the
contract itself.

## Contract storage layout

The contract uses both **instance storage** (small, contract-wide configuration that is loaded
on every invocation) and **persistent storage** (per-match and per-player records, addressed by
composite keys so arbitrarily many matches/players can be stored without growing the instance
entry). Persistent entries are kept alive with `bump_entry_ttl`, which extends an entry's
time-to-live whenever it is read or written so active matches are not archived by the ledger.

### Instance storage keys

| Key | Type | Purpose |
| --- | --- | --- |
| `coord` | `Address` | Coordinator address authorized to settle matches and manage configuration. |
| `fee` | `u32` | Platform fee in basis points (e.g. `500` = 5%) applied on winner settlement. |
| `pubkey` | `BytesN<32>` | Coordinator Ed25519 public key used for signature-based settlement (`resolve_match_with_signature`). |
| `signers` | `Vec<Address>` | Multisig signer set used for coordinator key rotation approvals. |
| `paused` | `bool` | Circuit breaker; blocks new match/tournament creation while `true`. |
| `trsy_vlt` | `Address` | Treasury vault destination for `emergency_drain`. |
| `xlm_tok` | `Address` | Native XLM Stellar Asset Contract (SAC) address used by `create_native_match`. |
| `gov_tok` | `Address` | Optional governance token granting fee discounts. |
| `w_limits` | `(i128, i128)` | Global `(min_wager, max_wager)` limits. |
| `(tok_wlim, token)` | `(i128, i128)` | Per-token wager limit override, keyed by token `Address`. |
| `(sup_tok, token)` | `bool` | Whitelist flag for a given wager token `Address`. |
| `timeout` | `u64` | Configurable default match timeout in seconds (`get_match_timeout`). |
| `nonce` | `u64` | Monotonic match-creation sequence nonce. |
| `(lk_tok, token)` | `i128` | Running total of tokens currently locked in escrow for a given token, used by the balance invariant check. |
| `guardians`, `g_thr`, `(adm_prop, id)`, `pend_rot` | various | Administrative multisig guardian set, approval threshold, pending admin proposals, and pending coordinator rotation state. |

### Persistent storage keys

| Key | Type | Purpose |
| --- | --- | --- |
| `game_code` (the `String` itself) | `Match` | The primary match record, stored directly under its game code. |
| `DataKey::Metrics` | `PlatformMetrics` | Aggregated platform counters (`total_matches_created`, `active_matches_count`, `total_volume_xlm`, `total_rake_collected`). |
| `DataKey::PlayerRating(Address)` | rating record | Committed Elo rating state for a player. |
| `DataKey::AccountNonce(Address)` | `u64` | Per-account deposit nonce for signed-deposit replay protection. |
| `DataKey::DrainSchedule` | `(Address, u64)` | Pending `(recipient, unlock_timestamp)` for the emergency drain timelock. |
| `DataKey::SideBetPool(game_code)` | `SideBetLedger` | Spectator side pool: White/Black totals, settlement outcome, fee taken, and unclaimed balances. Outlives the match record until every bettor has claimed. |
| `DataKey::SideBetStake(game_code, bettor, PlayerColor)` | `i128` | One spectator's unclaimed stake on one side; removed when claimed. |
| `(side_p, game_code)` | `SidePool` | Legacy (pre-ledger) side-bet pool. No longer written; existing pools are still paid out when their match ends. |
| `(dispute, game_code)` | `Dispute` | Active dispute record and its 48-hour timelock. |
| `(act_m, player_address)` | `Vec<String>` | List of game codes the player currently has active, used to enforce the max-active-matches limit. |
| `(sp_exp, player_address)` | signed-deposit data | Sponsored-deposit bookkeeping for gasless player onboarding flows. |
| `(elo_r, player_address)` | `u32` | Current Elo rating. |
| `(streak, player_address)` | `u32` | Current win streak counter used for milestone events. |
| `(ref_clm, tournament_id, player)` | `bool` | Marks that a player has already claimed a tournament refund. |

### The `Match` record

```rust
pub struct Match {
    pub game_code: String,               // Primary key
    pub player1: Address,
    pub player2: Option<Address>,        // None until join_match
    pub wager_amount: i128,              // Per-player wager, in token base units
    pub total_staked: i128,              // Pooled wager currently locked (normally 2 * wager_amount)
    pub created_at: u64,                  // Ledger timestamp at creation
    pub status: MatchStatus,
    pub winner: Option<Address>,
    pub token: Address,                   // Wager token (SAC) address
    pub nonce: u64,
    pub flags: u32,                       // Bitmask: cancel/draw proposal flags
    pub max_duration_seconds: u64,         // Per-match override of the default timeout
    pub cancellation_proposed_by: Option<Address>,
}
```

`MatchStatus` is a simple lifecycle enum:

| Variant | Meaning |
| --- | --- |
| `Pending` (0) | Created by player 1, awaiting player 2. |
| `Active` (1) | Both wagers locked, match in progress. |
| `Resolved` (2) | Settled by the coordinator (winner payout or draw refund). |
| `Refunded` (3) | Cancelled, timed out, or mutually cancelled; wagers refunded. |
| `EmergencyRefunded` (4) | Self-refunded by a player via `emergency_refund` after the coordinator inactivity timelock elapsed on an `Active` match (see below). |

## Error code catalog

All contract-level failures panic with a `EscrowError` (`#[contracterror]`, `#[repr(u32)]`), so
the numeric code below is what a transaction's failure result will report. This table matches the
enum defined in `contracts/soroban/contracts/escrow/src/lib.rs`.

| Error | Code | Cause | Recommended action |
| --- | --- | --- | --- |
| `NotInitialized` | 0 | Contract `init` has not been called. | Call `init` with a coordinator address and fee before any other method. |
| `MatchNotFound` | 1 | The supplied game code has no stored match. | Verify the game code; it may have been garbage-collected if stale for 30+ days. |
| `MatchAlreadyExists` | 2 | `create_match` reused an existing game code. | Generate a new unique game code. |
| `InvalidWager` | 3 | Wager amount was not positive. | Use a positive wager amount. |
| `MatchNotPending` | 4 | Action requires the match to still be `Pending`. | Only call pending-only actions (e.g. `cancel_pending_match`) before a second player joins. |
| `AlreadyJoined` | 5 | Player/spectator already joined or bet on this match. | Avoid double-submitting the join/bet transaction. |
| `CannotJoinOwnMatch` | 6 | Player 1 attempted to join their own match as player 2. | Join from a different wallet address. |
| `MatchNotActive` | 7 | Action requires the match to be `Active`. | Confirm the match has been joined (and not already settled/refunded) before calling. |
| `InvalidWinner` | 8 | Supplied winner address is not a participant. | Pass `player1`, `player2`, or `None` (draw) only. |
| `AlreadyResolvedOrRefunded` | 9 | Match is already `Resolved`, `Refunded`, or `EmergencyRefunded`. | Query `get_match` before attempting another settlement/refund call. |
| `TimeoutNotReached` | 10 | The configured refund timeout has not elapsed. | Wait until `created_at + timeout` has passed, or check `get_match_expiration`. |
| `Unauthorized` | 11 | Caller is not permitted to perform this action. | Call with the coordinator or match-participant identity the method expects. |
| `InsufficientFunds` | 12 | Player's token balance can't cover the wager. | Fund the player account before creating/joining a match. |
| `MaxActiveMatchesReached` | 13 | Player already has the maximum number of active matches (5). | Resolve or let an existing match expire before starting another. |
| `InvalidTournament` | 14 | Tournament parameters or status are invalid for the requested action. | Check the tournament's current `TournamentStatus` and configured limits. |
| `SideBetNotFound` | 15 | No side-bet pool exists for the given match. | Confirm a spectator bet has actually been placed. |
| `SideBetClosed` | 16 | The match's side-bet pool is no longer accepting bets. | Place side bets only while the match is open for them (before resolution). |
| `CancellationAlreadyRequested` | 17 | A mutual-cancellation proposal is already pending. | Confirm the existing proposal instead of creating a new one. |
| `TokenNotWhitelisted` | 18 | The wager token is not on the admin whitelist. | Have the coordinator call `add_whitelisted_token` first. |
| `TokenAlreadyWhitelisted` | 19 | Token is already present in the whitelist. | No action needed; check `get_whitelisted_tokens`. |
| `NotForfeitable` | 20 | Match has no joined player 2 and cannot be forfeited. | Only forfeit matches that are `Active`. |
| `InvalidForfeitPlayer` | 21 | The forfeiting player is not a participant in the match. | Pass `player1` or `player2`'s address. |
| `InsufficientAllowance` | 22 | Token allowance granted to the contract is below the required amount. | Approve the contract for at least the wager amount before depositing. |
| `AlreadyDisputed` | 23 | A dispute has already been raised for this match. | Use `resolve_dispute` instead of raising a second dispute. |
| `DisputeNotFound` | 24 | No dispute record exists for the match. | Confirm a dispute was actually raised. |
| `DisputeTimeLockActive` | 25 | The 48-hour dispute timelock has not elapsed. | Wait for `release_at`, or have the coordinator arbitrate via `resolve_dispute`. |
| `InvalidBatchSize` | 26 | A batch resolution/garbage-collection request was empty or exceeded the allowed size. | Keep batches within `MAX_BATCH_RESOLUTIONS` / `MAX_BATCH_GC_MATCHES`. |
| `MatchNotStale` | 27 | Match is not eligible for garbage collection (not settled, or not yet 30 days old). | Only GC matches that are `Resolved`/`Refunded`/`EmergencyRefunded` and past `STALE_MATCH_THRESHOLD_SECS`. |
| `MatchExpired` | 28 | Match has exceeded its allowed duration. | Use the appropriate refund/timeout-claim method instead of continuing play. |
| `WagerBelowMinimum` | 29 | Wager is below the configured minimum. | Increase the wager to at least the configured minimum. |
| `WagerAboveMaximum` | 30 | Wager exceeds the configured maximum. | Reduce the wager to the configured maximum. |
| `InvalidWagerLimit` | 31 | Minimum/maximum wager configuration is invalid (min > max, or non-positive). | Ensure `min_wager <= max_wager` and both are positive when calling `set_wager_limits`. |
| `ContractPaused` | 32 | New match/tournament creation is disabled while the contract is paused. | Wait for the coordinator to `unpause`, or use administrative/refund paths that remain available. |
| `RotationNotProposed` | 33 | No coordinator key rotation is currently pending. | Propose a rotation before trying to approve/execute one. |
| `RotationAlreadyProposed` | 34 | A rotation to a different address is already pending. | Cancel/execute the pending rotation before proposing another. |
| `AlreadyApproved` | 35 | This signer already approved the pending rotation. | No action needed; wait for remaining signers. |
| `UnauthorizedSigner` | 36 | Caller is not a configured multisig signer. | Use one of the addresses in the signer set. |
| `ReentrancyGuard` | 37 | A guarded function was re-entered during its own execution. | This indicates a client/integration bug; do not call escrow methods recursively from within a callback. |
| `InvariantViolated` | 38 | The contract's token balance fell below its tracked locked total. | Treat as a critical incident; stop traffic and investigate before any further writes. |
| `NotPaused` | 39 | Emergency drain requires the contract to be paused first. | Call `pause` before `emergency_drain`. |
| `MigrationNotAuthorized` | 40 | No authorized migration window is open. | Have a guardian authorize the migration before draining. |
| `TreasuryVaultNotSet` | 41 | No treasury vault address has been configured. | Call `set_treasury_vault` before draining funds. |
| `NothingToDrain` | 42 | Contract holds no positive balance of the requested token. | Confirm the token address and that funds are actually present. |
| `NonceAlreadyUsed` | 43 | A signed-deposit/signature nonce has already been consumed. | Generate a fresh nonce for each signed payload. |
| `InvalidNonce` | 44 | Submitted nonce does not match the expected sequence. | Fetch the current expected nonce before signing the next payload. |
| `InvalidMatchDuration` | 45 | Requested match duration is outside `[MIN_MATCH_DURATION_SECS, MAX_MATCH_DURATION_SECS]` (2 minutes–24 hours). | Choose a duration within the allowed range. |
| `TimeoutNotExpired` | 46 | A timeout-dependent action (timeout-victory claim, abandoned refund, or `emergency_refund`) was called before its deadline. | Wait until the relevant deadline (`created_at + duration`, or `created_at + EMERGENCY_TIMEOUT_SECONDS` for emergency refunds) has passed. |
| `NoCancellationProposed` | 47 | No mutual-cancellation proposal exists to confirm. | Have one player propose cancellation before the other confirms it. |
| `CannotConfirmOwnProposal` | 48 | The same player tried to confirm their own cancellation proposal. | Confirmation must come from the other participant. |
| `UnauthorizedPlayer` | 49 | Caller is not an authorized participant (`player1`/`player2`) for this action. | Call `emergency_refund` / cancellation confirmation using a wallet that is actually in the match. |

A Soroban error enum holds at most 50 cases, so codes from 50 upward are raised as `EscrowErrorExt`:

| Error | Code | Cause | Recommended action |
| --- | --- | --- | --- |
| `SideBetsNotSettled` | 54 | `claim_side_bet` was called before the match ended. | Claim after the match is resolved, refunded, or cancelled. |
| `SideBetTokenMismatch` | 55 | `place_side_bet` used a token other than the match wager token. | Pass the match's `token`. |

## Spectator side bets

Spectators back White (`player1`) or Black (`player2`) with `place_side_bet(game_code, bettor, chosen_player, token, amount)`.
Stakes must use the match token, respect the token's wager limits, and come from a wallet that is not playing the match.
Betting is open while the match is `Pending`/`Active` and not expired; the coordinator can close it earlier with
`close_side_betting(game_code)` (for example, once the game reaches move 10).

When the match ends the side pool is settled without iterating over bettors, and each spectator withdraws with
`claim_side_bet(game_code, bettor)`:

- **Decisive result:** the coordinator-configured fee (`set_side_bet_fee_bps`, at most `MAX_SIDE_BET_FEE_BPS` = 500) is
  taken from the losing pool and sent to the treasury vault (or the coordinator if none is set). Each winning bettor
  receives `stake + floor(stake * (losing_pool - fee) / winning_pool)`, and the final winning claim sends the rounding
  remainder to the treasury, so payouts plus fees always equal the total staked. Losing stakes claim zero.
- **Draw, refund, cancellation, or nobody backed the winner:** every stake is returned in full with no fee.

## Token precision and decimal handling

Every amount in the contract — `wager_amount`, `total_staked`, side-bet stakes, fees, and refund
splits — is an `i128` expressed in the token's smallest indivisible unit, never a fractional
decimal. Both the native XLM Stellar Asset Contract and standard Stellar-issued assets such as
USDC use **7 decimal places**, so:

```
raw_amount (i128) = display_amount * 10^7
display_amount     = raw_amount / 10^7
```

For example, a 12.5 XLM wager is represented on-chain as the integer `125_000_000` (stroops), and
a 3.00 USDC side bet is represented as `30_000_000`. Frontend and backend code must perform this
scaling in both directions:

- **Before invoking the contract** (`create_match`, `join_match`, `place_side_bet`, etc.), multiply
  the user-facing decimal amount by `10^7` and round to an integer — never pass a float directly.
- **After reading contract state** (`get_match`, event payloads, `PlatformMetrics`), divide the
  returned `i128` by `10^7` before displaying it to a user.

Because every arithmetic operation inside the contract uses checked addition/subtraction
(`checked_add`/`checked_sub`), an overflow or underflow panics with an invariant error rather than
silently wrapping — client code should treat a rejected transaction as a signal to re-validate the
scaled amount, not retry blindly.

## Local development and sandbox testing

Soroban contract and backend development does not need to depend on public Testnet uptime. The
Stellar CLI (`stellar`) can run a fully local, throwaway network for fast iteration.

### 1. Start a local network

```bash
stellar network start local --limits testnet
stellar network use local
```

This runs a local Soroban-enabled node in the background. If your installed CLI predates the
`stellar` binary rename, substitute `soroban` for `stellar` in every command below.

### 2. Create local identities and fund them

```bash
stellar keys generate coordinator --network local --fund
stellar keys generate player1 --network local --fund
stellar keys generate player2 --network local --fund
```

`--fund` uses the local network's built-in friendbot equivalent, so no public Testnet friendbot
call is required.

### 3. Build and deploy the contract locally

From `contracts/soroban`:

```bash
rustup target add wasm32-unknown-unknown
cargo test
cargo build --target wasm32-unknown-unknown --release

stellar contract deploy \
  --network local \
  --source coordinator \
  --wasm target/wasm32-unknown-unknown/release/escrow.wasm
```

Save the printed contract ID:

```bash
export CONTRACT_ID='<deployed-contract-id>'
```

### 4. Deploy a local test token and initialize the escrow

```bash
# Deploy a local Stellar Asset Contract to use as the wager token.
stellar contract asset deploy \
  --network local \
  --source coordinator \
  --asset NATIVE

stellar contract invoke --network local --source coordinator --id "$CONTRACT_ID" \
  -- init --coordinator "$(stellar keys address coordinator)" --admin_bps 500

stellar contract invoke --network local --source coordinator --id "$CONTRACT_ID" \
  -- add_whitelisted_token --token '<local-token-sac-id>'
```

### 5. Exercise the match lifecycle

```bash
stellar contract invoke --network local --source player1 --id "$CONTRACT_ID" \
  -- create_match --game_code '"LOCAL1"' --player1 "$(stellar keys address player1)" \
     --token '<local-token-sac-id>' --amount 1000000

stellar contract invoke --network local --source player2 --id "$CONTRACT_ID" \
  -- join_match --game_code '"LOCAL1"' --player2 "$(stellar keys address player2)"

stellar contract invoke --network local --id "$CONTRACT_ID" -- get_match --game_code '"LOCAL1"'
```

Point the backend's `SOROBAN_RPC_URL` and contract-ID configuration at the local network's RPC
endpoint (printed by `stellar network start local`) to develop against this contract instance
without any Testnet dependency. For Mainnet/Testnet deployment procedures and the production
release checklist, see [`contracts/soroban/DEPLOYMENT.md`](../contracts/soroban/DEPLOYMENT.md).

## Related documentation

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — component responsibilities, trust boundaries, and the
  end-to-end match sequence diagram.
- [`contracts/soroban/DEPLOYMENT.md`](../contracts/soroban/DEPLOYMENT.md) — Testnet/Mainnet
  deployment runbook and release checklist.
