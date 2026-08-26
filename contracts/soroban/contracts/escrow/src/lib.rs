#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, token,
    Address, Env, IntoVal, String, Symbol, Val, Vec,
};

/// Remaining TTL (in ledgers) below which escrow storage entries are auto-extended (~6 days).
pub const STORAGE_TTL_THRESHOLD: u32 = 103_680;
/// TTL (in ledgers) applied when escrow storage entries are auto-extended (~30 days).
pub const STORAGE_TTL_EXTENDED: u32 = 518_400;
/// Duration (in seconds) disputed funds stay locked before arbitration (48 hours).
pub const DISPUTE_TIMELOCK_SECS: u64 = 172_800;
/// Maximum number of matches resolvable in a single atomic batch transaction.
pub const MAX_BATCH_RESOLUTIONS: u32 = 10;
/// Duration (in seconds) after which settled or refunded matches become eligible for garbage collection (30 days).
pub const STALE_MATCH_THRESHOLD_SECS: u64 = 2_592_000;
/// Default duration (in seconds) after which a pending or active match expires (1 hour).
pub const MATCH_EXPIRATION_SECS: u64 = 3_600;
/// Default minimum allowable wager amount (1 unit/stroop).
pub const DEFAULT_MIN_WAGER: i128 = 1;
/// Default maximum allowable wager amount (maximum positive i128).
pub const DEFAULT_MAX_WAGER: i128 = i128::MAX;

/// Errors returned by the Chesster Escrow smart contract.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum EscrowError {
    /// Contract has not been initialized yet.
    NotInitialized = 0,
    /// Specified match game code was not found.
    MatchNotFound = 1,
    /// Match with specified game code already exists.
    MatchAlreadyExists = 2,
    /// Wager amount must be positive.
    InvalidWager = 3,
    /// Action requires match to be in Pending status.
    MatchNotPending = 4,
    /// Player or spectator has already joined/placed bet.
    AlreadyJoined = 5,
    /// Player cannot join their own created match.
    CannotJoinOwnMatch = 6,
    /// Action requires match to be in Active status.
    MatchNotActive = 7,
    /// Specified winner address is invalid for match.
    InvalidWinner = 8,
    /// Match is already resolved or refunded.
    AlreadyResolvedOrRefunded = 9,
    /// Refund timeout period (1 hour) has not elapsed.
    TimeoutNotReached = 10,
    /// Caller is unauthorized to perform action.
    Unauthorized = 11,
    /// Player token balance is insufficient for wager.
    InsufficientFunds = 12,
    /// Player has reached maximum active matches limit (5).
    MaxActiveMatchesReached = 13,
    /// Tournament status or parameter is invalid.
    InvalidTournament = 14,
    /// Side bet entry was not found.
    SideBetNotFound = 15,
    /// Match side pool is closed for new bets.
    SideBetClosed = 16,
    /// Cancellation request already recorded.
    CancellationAlreadyRequested = 17,
    /// Specified wager token is not in the contract whitelist.
    TokenNotWhitelisted = 18,
    /// Specified token is already present in the whitelist.
    TokenAlreadyWhitelisted = 19,
    /// Match is not eligible for forfeit.
    NotForfeitable = 20,
    /// Specified forfeiting player is invalid.
    InvalidForfeitPlayer = 21,
    /// Token allowance granted to contract is insufficient.
    InsufficientAllowance = 22,
    /// Dispute has already been raised for this match.
    AlreadyDisputed = 23,
    /// Dispute record not found.
    DisputeNotFound = 24,
    /// Dispute timelock (48 hours) is currently active.
    DisputeTimeLockActive = 25,
    /// Batch resolution size is empty or exceeds limit.
    InvalidBatchSize = 26,
    /// Match is not stale (must be resolved/refunded and >30 days old).
    MatchNotStale = 27,
    /// Match has expired based on ledger timestamp timeout.
    MatchExpired = 28,
    /// Wager amount is below configured minimum limit.
    WagerBelowMinimum = 29,
    /// Wager amount exceeds configured maximum limit.
    WagerAboveMaximum = 30,
    /// Minimum wager limit cannot exceed maximum wager limit or must be positive.
    InvalidWagerLimit = 31,
    /// Contract is paused; new match and tournament creation is temporarily disabled.
    ContractPaused = 32,
}

/// Lifecycle status of a chess match escrow.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MatchStatus {
    /// Match created by Player 1, awaiting Player 2 join.
    Pending = 0,
    /// Player 2 joined, wagers locked, match in progress.
    Active = 1,
    /// Match resolved, payouts distributed to winner or refunded on draw.
    Resolved = 2,
    /// Match canceled or timed out, wagers refunded to players.
    Refunded = 3,
}

/// Lifecycle status of a tournament prize pool.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TournamentStatus {
    /// Tournament open for player registrations.
    Open = 0,
    /// Tournament registration closed and matches in progress.
    Active = 1,
    /// Tournament completed and prize distribution finished.
    Completed = 2,
}

/// Spectator side bet entry on match winner.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SideBet {
    /// Address of spectator who placed the side bet.
    pub spectator: Address,
    /// Address of player predicted to win.
    pub predicted_winner: Address,
    /// Amount staked on prediction.
    pub amount: i128,
}

/// Spectator side bet pool for a match.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SidePool {
    /// Associated match game code.
    pub game_code: String,
    /// Total amount staked on Player 1.
    pub total_player1_side_staked: i128,
    /// Total amount staked on Player 2.
    pub total_player2_side_staked: i128,
    /// List of individual spectator side bets.
    pub bets: Vec<SideBet>,
}

/// Tournament prize pool storage representation.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TournamentPrizePool {
    /// Unique tournament identifier.
    pub tournament_id: String,
    /// Vector of registered player addresses.
    pub players: Vec<Address>,
    /// Required buy-in amount per player.
    pub buy_in_amount: i128,
    /// Accumulated total prize pool.
    pub total_pool: i128,
    /// Prize payout distribution per rank index.
    pub prize_distribution: Vec<i128>,
    /// Final player placement rankings after tournament completion.
    pub final_rankings: Vec<Address>,
    /// Current tournament lifecycle status.
    pub status: TournamentStatus,
    /// Creation timestamp (ledger timestamp).
    pub created_at: u64,
    /// Token address used for buy-ins and prizes.
    pub token: Address,
}

/// Status of a match dispute.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DisputeStatus {
    /// Dispute locked during 48-hour timelock queue.
    Locked = 0,
    /// Dispute arbitrated and settled by coordinator.
    Settled = 1,
}

/// Dispute record for a match.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Dispute {
    /// Disputed match game code.
    pub game_code: String,
    /// Player address who initiated dispute.
    pub raised_by: Address,
    /// Dispute creation timestamp.
    pub created_at: u64,
    /// Timestamp when dispute timelock expires (created_at + 48h).
    pub release_at: u64,
    /// Current dispute resolution status.
    pub status: DisputeStatus,
}

/// Match resolution entry for batch resolution transactions.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchResolution {
    /// Game code of match to resolve.
    pub game_code: String,
    /// Winner address, or None for a draw.
    pub winner: Option<Address>,
}

/// Full details and state representation of an escrow match.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Match {
    /// Unique match game code identifier.
    pub game_code: String,
    /// Address of match creator (Player 1).
    pub player1: Address,
    /// Address of joined opponent (Player 2), if joined.
    pub player2: Option<Address>,
    /// Individual wager requirement per player.
    pub wager_amount: i128,
    /// Total pooled wager amount currently locked in escrow.
    pub total_staked: i128,
    /// Creation timestamp of match.
    pub created_at: u64,
    /// Current lifecycle status of match.
    pub status: MatchStatus,
    /// Winner address if match resolved with a winner.
    pub winner: Option<Address>,
    /// Token contract address used for wagering.
    pub token: Address,
    /// Match creation sequence nonce.
    pub nonce: u64,
    /// Mutual cancellation request indicator for Player 1.
    pub cancel_requested_player1: bool,
    /// Mutual cancellation request indicator for Player 2.
    pub cancel_requested_player2: bool,
    /// Cooperative draw request indicator for Player 1.
    pub draw_requested_player1: bool,
    /// Cooperative draw request indicator for Player 2.
    pub draw_requested_player2: bool,
}

// ---------------------------------------------------------------------------
// Typed contract events
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
/// Published after Player 1 creates a match and their wager is locked.
pub struct MatchCreatedEvent {
    /// Identifier supplied by the client for this match.
    pub game_code: String,
    /// Authorized address of the creating player.
    pub player1: Address,
    /// Stellar Asset Contract used for the wager.
    pub token: Address,
    /// Per-player amount locked for the match.
    pub wager_amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
/// Published after Player 2 joins and the full match pool is funded.
pub struct MatchFundedEvent {
    /// Identifier of the funded match.
    pub game_code: String,
    /// Authorized address of the joining player.
    pub player2: Address,
    /// Combined amount currently held in escrow.
    pub total_staked: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
/// Published when the coordinator settles a match or refunds a draw.
pub struct MatchResolvedEvent {
    /// Identifier of the settled match.
    pub game_code: String,
    /// Recipient of the winner payout, or `None` for a draw.
    pub winner: Option<Address>,
    /// Platform fee transferred during a winner settlement.
    pub admin_fee: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
/// Published when the coordinator awards a match due to a player forfeit.
pub struct MatchForfeitedEvent {
    /// Identifier of the forfeited match.
    pub game_code: String,
    /// Participant whose forfeit triggered settlement.
    pub forfeiting_player: Address,
    /// Opponent who received the resulting payout.
    pub winner: Address,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
/// Published when a pending match is mutually cancelled.
pub struct MatchCancelledEvent {
    /// Identifier of the cancelled match.
    pub game_code: String,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
/// Published when a timed-out or otherwise refundable match is refunded.
pub struct MatchRefundedEvent {
    /// Identifier of the refunded match.
    pub game_code: String,
}

/// Configured minimum and maximum allowable wager limits (Issue #23).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WagerLimits {
    /// Minimum allowable wager amount.
    pub min_wager: i128,
    /// Maximum allowable wager amount.
    pub max_wager: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
/// Published after the coordinator updates global wager limits.
pub struct WagerLimitsUpdatedEvent {
    /// New inclusive global minimum wager.
    pub min_wager: i128,
    /// New inclusive global maximum wager.
    pub max_wager: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
/// Published after the coordinator updates a token-specific wager limit.
pub struct TokenWagerLimitsUpdatedEvent {
    /// Token whose limits were updated.
    pub token: Address,
    /// New inclusive minimum for this token.
    pub min_wager: i128,
    /// New inclusive maximum for this token.
    pub max_wager: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
/// Published when a match passes its configured expiration time.
pub struct MatchExpiredEvent {
    /// Identifier of the expired match.
    pub game_code: String,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
/// Published when the coordinator records a player's Elo rating.
pub struct PlayerEloUpdatedEvent {
    /// Player whose rating changed.
    pub player: Address,
    /// Newly recorded Elo rating.
    pub new_elo: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
/// Published when the coordinator activates the emergency circuit breaker pause.
pub struct ContractPausedEvent {
    /// Coordinator address that triggered the pause.
    pub coordinator: Address,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
/// Published when the coordinator lifts the emergency circuit breaker pause.
pub struct ContractUnpausedEvent {
    /// Coordinator address that lifted the pause.
    pub coordinator: Address,
}

/// Chesster Escrow Smart Contract instance.
#[contract]
pub struct ChessterEscrow;

#[contractimpl]
impl ChessterEscrow {
    /// Initializes the contract with coordinator address and admin fee basis points.
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    /// * `coordinator` - Coordinator wallet address.
    /// * `admin_bps` - Admin fee in basis points (500 = 5%).
    pub fn init(env: Env, coordinator: Address, admin_bps: u32) {
        coordinator.require_auth();
        env.storage()
            .instance()
            .set(&symbol_short!("coord"), &coordinator);
        env.storage()
            .instance()
            .set(&symbol_short!("fee"), &admin_bps);
    }

    /// Pauses the contract, blocking new match and tournament creation (coordinator only).
    ///
    /// Refunds and other settlement operations remain available while paused.
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    pub fn pause(env: Env) {
        let coordinator = Self::get_coordinator(env.clone());
        coordinator.require_auth();
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "paused"), &true);
        Self::bump_instance_ttl(&env);
        env.events().publish(
            (symbol_short!("paused"),),
            ContractPausedEvent { coordinator },
        );
    }

    /// Unpauses the contract, re-enabling match and tournament creation (coordinator only).
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    pub fn unpause(env: Env) {
        let coordinator = Self::get_coordinator(env.clone());
        coordinator.require_auth();
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "paused"), &false);
        Self::bump_instance_ttl(&env);
        env.events().publish(
            (symbol_short!("unpaused"),),
            ContractUnpausedEvent { coordinator },
        );
    }

    /// Returns whether the contract is currently paused.
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    ///
    /// # Returns
    /// * `bool` - `true` if the contract is paused, `false` otherwise.
    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&Symbol::new(&env, "paused"))
            .unwrap_or(false)
    }

    /// Sets governance token address for calculating fee discounts (Issue #36).
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    /// * `gov_token` - Governance token contract address.
    pub fn set_gov_token(env: Env, gov_token: Address) {
        let coordinator = Self::get_coordinator(env.clone());
        coordinator.require_auth();
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "gov_tok"), &gov_token);
    }

    /// Retrieves governance token address if configured.
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    ///
    /// # Returns
    /// * `Option<Address>` - Governance token address if set.
    pub fn get_gov_token(env: Env) -> Option<Address> {
        env.storage().instance().get(&Symbol::new(&env, "gov_tok"))
    }

    /// Adds a supported token for wagers (Coordinator only).
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    /// * `token` - Token contract address to add.
    pub fn add_supported_token(env: Env, token: Address) {
        let coordinator = Self::get_coordinator(env.clone());
        coordinator.require_auth();
        let key = (Symbol::new(&env, "sup_tok"), token);
        env.storage().instance().set(&key, &true);
    }

    /// Removes a supported token (Coordinator only).
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    /// * `token` - Token contract address to remove.
    pub fn remove_supported_token(env: Env, token: Address) {
        let coordinator = Self::get_coordinator(env.clone());
        coordinator.require_auth();
        let key = (Symbol::new(&env, "sup_tok"), token);
        env.storage().instance().remove(&key);
    }

    /// Checks if a token address is currently supported for wagering.
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    /// * `token` - Token contract address to query.
    ///
    /// # Returns
    /// * `bool` - True if supported, false otherwise.
    pub fn is_token_supported(env: Env, token: Address) -> bool {
        let key = (Symbol::new(&env, "sup_tok"), token);
        if env.storage().instance().has(&key) {
            return env.storage().instance().get(&key).unwrap_or(false);
        }
        true
    }

    /// Calculates effective fee basis points for a player based on governance token balance (Issue #36).
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    /// * `player` - Player address to query.
    ///
    /// # Returns
    /// * `u32` - Fee in basis points after applied holdings tier discount.
    pub fn get_effective_fee_bps(env: Env, player: Address) -> u32 {
        let base_fee = Self::get_fee_bps(env.clone());
        if let Some(gov_token) = Self::get_gov_token(env.clone()) {
            let token_client = token::Client::new(&env, &gov_token);
            let balance = token_client.balance(&player);

            if balance >= 10_000 {
                base_fee / 2
            } else if balance >= 1_000 {
                (base_fee * 80) / 100
            } else if balance >= 100 {
                (base_fee * 90) / 100
            } else {
                base_fee
            }
        } else {
            base_fee
        }
    }

    /// Retrieves current match creation nonce counter (Issue #34).
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    ///
    /// # Returns
    /// * `u64` - Nonce value.
    pub fn get_match_nonce(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&Symbol::new(&env, "nonce"))
            .unwrap_or(0)
    }

    /// Retrieves registered coordinator address.
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    ///
    /// # Returns
    /// * `Address` - Coordinator address.
    pub fn get_coordinator(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&symbol_short!("coord"))
            .unwrap_or_else(|| panic_with_error!(&env, EscrowError::NotInitialized))
    }

    /// Retrieves base admin fee in basis points.
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    ///
    /// # Returns
    /// * `u32` - Base fee in basis points.
    pub fn get_fee_bps(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&symbol_short!("fee"))
            .unwrap_or(500)
    }

    /// Configures base platform fee basis points (Issue #19).
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    /// * `fee_bps` - Fee basis points (e.g. 500 = 5%).
    pub fn set_fee_bps(env: Env, fee_bps: u32) {
        let coordinator = Self::get_coordinator(env.clone());
        coordinator.require_auth();
        if fee_bps > 10000 {
            panic_with_error!(&env, EscrowError::InvalidWager);
        }
        env.storage()
            .instance()
            .set(&symbol_short!("fee"), &fee_bps);
    }

    /// Calculates platform fee basis points based on wager amount tiering (Issue #19).
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    /// * `wager_amount` - Wager amount per player.
    ///
    /// # Returns
    /// * `u32` - Effective fee basis points after wager volume tier discount.
    pub fn get_wager_tier_fee_bps(env: Env, wager_amount: i128) -> u32 {
        let base_fee = Self::get_fee_bps(env.clone());
        if wager_amount >= 10_000 {
            (base_fee * 70) / 100
        } else if wager_amount >= 1_000 {
            (base_fee * 85) / 100
        } else {
            base_fee
        }
    }

    /// Configures protocol treasury vault address for platform fee collection (Issue #19).
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    /// * `treasury_vault` - Treasury vault wallet contract address.
    pub fn set_treasury_vault(env: Env, treasury_vault: Address) {
        let coordinator = Self::get_coordinator(env.clone());
        coordinator.require_auth();
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "trsy_vlt"), &treasury_vault);
    }

    /// Retrieves configured treasury vault address if set (Issue #19).
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    ///
    /// # Returns
    /// * `Option<Address>` - Treasury vault address if set.
    pub fn get_treasury_vault(env: Env) -> Option<Address> {
        env.storage().instance().get(&Symbol::new(&env, "trsy_vlt"))
    }

    /// Retrieves current contract treasury balance for specified token.
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    /// * `token` - Token address.
    ///
    /// # Returns
    /// * `i128` - Treasury token balance.
    pub fn get_treasury(env: Env, token: Address) -> i128 {
        let token_client = token::Client::new(&env, &token);
        token_client.balance(&env.current_contract_address())
    }

    /// Configures native XLM SAC token address in contract storage (Issue #38).
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    /// * `native_token` - Address of native XLM SAC token.
    pub fn set_native_xlm_address(env: Env, native_token: Address) {
        let coordinator = Self::get_coordinator(env.clone());
        coordinator.require_auth();
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "xlm_tok"), &native_token);
    }

    /// Retrieves configured native XLM SAC token address (Issue #38).
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    ///
    /// # Returns
    /// * `Option<Address>` - Address of native XLM token if set.
    pub fn get_native_xlm_address(env: Env) -> Option<Address> {
        env.storage().instance().get(&Symbol::new(&env, "xlm_tok"))
    }

    /// Creates a match using the configured native XLM SAC token (Issue #38).
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    /// * `game_code` - Unique match game code.
    /// * `player1` - Creator player address.
    /// * `amount` - Wager amount.
    pub fn create_native_match(env: Env, game_code: String, player1: Address, amount: i128) {
        let native_token = Self::get_native_xlm_address(env.clone())
            .unwrap_or_else(|| panic_with_error!(&env, EscrowError::NotInitialized));
        Self::create_match(env, game_code, player1, native_token, amount);
    }

    /// Joins a native XLM match (Issue #38).
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    /// * `game_code` - Unique match game code.
    /// * `player2` - Joining player address.
    pub fn join_native_match(env: Env, game_code: String, player2: Address) {
        Self::join_match(env, game_code, player2);
    }

    fn set_wager_limits_internal(env: &Env, min_wager: i128, max_wager: i128) {
        if min_wager <= 0 || max_wager < min_wager {
            panic_with_error!(env, EscrowError::InvalidWagerLimit);
        }

        let limits = WagerLimits {
            min_wager,
            max_wager,
        };
        env.storage()
            .instance()
            .set(&Symbol::new(env, "w_limits"), &limits);
        Self::bump_instance_ttl(env);

        env.events().publish(
            (symbol_short!("w_limits"),),
            WagerLimitsUpdatedEvent {
                min_wager,
                max_wager,
            },
        );
    }

    /// Configures global minimum and maximum allowable wager limits (Coordinator only) (Issue #23).
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    /// * `min_wager` - Minimum allowable wager amount (must be > 0).
    /// * `max_wager` - Maximum allowable wager amount (must be >= min_wager).
    pub fn set_wager_limits(env: Env, min_wager: i128, max_wager: i128) {
        let coordinator = Self::get_coordinator(env.clone());
        coordinator.require_auth();
        Self::set_wager_limits_internal(&env, min_wager, max_wager);
    }

    /// Sets global minimum wager limit while keeping current maximum (Coordinator only) (Issue #23).
    pub fn set_min_wager(env: Env, min_wager: i128) {
        let current_max = Self::get_max_wager(env.clone());
        Self::set_wager_limits(env, min_wager, current_max);
    }

    /// Sets global maximum wager limit while keeping current minimum (Coordinator only) (Issue #23).
    pub fn set_max_wager(env: Env, max_wager: i128) {
        let current_min = Self::get_min_wager(env.clone());
        Self::set_wager_limits(env, current_min, max_wager);
    }

    /// Retrieves configured global minimum and maximum allowable wager limits (Issue #23).
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    ///
    /// # Returns
    /// * `WagerLimits` - Struct containing `min_wager` and `max_wager`.
    pub fn get_wager_limits(env: Env) -> WagerLimits {
        env.storage()
            .instance()
            .get(&Symbol::new(&env, "w_limits"))
            .unwrap_or(WagerLimits {
                min_wager: DEFAULT_MIN_WAGER,
                max_wager: DEFAULT_MAX_WAGER,
            })
    }

    /// Retrieves current global minimum allowable wager limit (Issue #23).
    pub fn get_min_wager(env: Env) -> i128 {
        Self::get_wager_limits(env).min_wager
    }

    /// Retrieves current global maximum allowable wager limit (Issue #23).
    pub fn get_max_wager(env: Env) -> i128 {
        Self::get_wager_limits(env).max_wager
    }

    fn set_token_wager_limits_internal(
        env: &Env,
        token: &Address,
        min_wager: i128,
        max_wager: i128,
    ) {
        if min_wager <= 0 || max_wager < min_wager {
            panic_with_error!(env, EscrowError::InvalidWagerLimit);
        }

        let limits = WagerLimits {
            min_wager,
            max_wager,
        };
        let key = (Symbol::new(env, "tok_wlim"), token.clone());
        env.storage().instance().set(&key, &limits);
        Self::bump_instance_ttl(env);

        env.events().publish(
            (symbol_short!("tok_wlim"), token.clone()),
            TokenWagerLimitsUpdatedEvent {
                token: token.clone(),
                min_wager,
                max_wager,
            },
        );
    }

    /// Configures token-specific minimum and maximum wager limits (Coordinator only) (Issue #23).
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    /// * `token` - Token address.
    /// * `min_wager` - Minimum allowable wager for token (must be > 0).
    /// * `max_wager` - Maximum allowable wager for token (must be >= min_wager).
    pub fn set_token_wager_limits(env: Env, token: Address, min_wager: i128, max_wager: i128) {
        let coordinator = Self::get_coordinator(env.clone());
        coordinator.require_auth();
        Self::set_token_wager_limits_internal(&env, &token, min_wager, max_wager);
    }

    /// Removes token-specific wager limits, falling back to global limits (Coordinator only) (Issue #23).
    pub fn remove_token_wager_limits(env: Env, token: Address) {
        let coordinator = Self::get_coordinator(env.clone());
        coordinator.require_auth();

        let key = (Symbol::new(&env, "tok_wlim"), token);
        env.storage().instance().remove(&key);
        Self::bump_instance_ttl(&env);
    }

    /// Retrieves token-specific wager limits if configured, or falls back to global limits (Issue #23).
    pub fn get_token_wager_limits(env: Env, token: Address) -> WagerLimits {
        let key = (Symbol::new(&env, "tok_wlim"), token);
        if let Some(limits) = env.storage().instance().get(&key) {
            limits
        } else {
            Self::get_wager_limits(env)
        }
    }

    /// Retrieves minimum allowable wager limit for specified token (Issue #23).
    pub fn get_token_min_wager(env: Env, token: Address) -> i128 {
        Self::get_token_wager_limits(env, token).min_wager
    }

    /// Retrieves maximum allowable wager limit for specified token (Issue #23).
    pub fn get_token_max_wager(env: Env, token: Address) -> i128 {
        Self::get_token_wager_limits(env, token).max_wager
    }

    /// Scales global wager limits dynamically by a scale factor in basis points (10000 = 100%) (Coordinator only) (Issue #23).
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    /// * `scale_bps` - Scale factor in basis points (must be > 0).
    pub fn scale_wager_limits(env: Env, scale_bps: u32) {
        let coordinator = Self::get_coordinator(env.clone());
        coordinator.require_auth();

        if scale_bps == 0 {
            panic_with_error!(&env, EscrowError::InvalidWagerLimit);
        }

        let current = Self::get_wager_limits(env.clone());
        let new_min = (current.min_wager * (scale_bps as i128)) / 10_000;
        let new_min = if new_min <= 0 { 1 } else { new_min };

        let new_max = if current.max_wager == DEFAULT_MAX_WAGER {
            DEFAULT_MAX_WAGER
        } else {
            (current.max_wager * (scale_bps as i128)) / 10_000
        };

        if new_max < new_min {
            panic_with_error!(&env, EscrowError::InvalidWagerLimit);
        }

        Self::set_wager_limits_internal(&env, new_min, new_max);
    }

    /// Scales token-specific wager limits dynamically by a scale factor in basis points (Coordinator only) (Issue #23).
    pub fn scale_token_wager_limits(env: Env, token: Address, scale_bps: u32) {
        let coordinator = Self::get_coordinator(env.clone());
        coordinator.require_auth();

        if scale_bps == 0 {
            panic_with_error!(&env, EscrowError::InvalidWagerLimit);
        }

        let current = Self::get_token_wager_limits(env.clone(), token.clone());
        let new_min = (current.min_wager * (scale_bps as i128)) / 10_000;
        let new_min = if new_min <= 0 { 1 } else { new_min };

        let new_max = if current.max_wager == DEFAULT_MAX_WAGER {
            DEFAULT_MAX_WAGER
        } else {
            (current.max_wager * (scale_bps as i128)) / 10_000
        };

        if new_max < new_min {
            panic_with_error!(&env, EscrowError::InvalidWagerLimit);
        }

        Self::set_token_wager_limits_internal(&env, &token, new_min, new_max);
    }

    fn whitelist_key(env: &Env) -> Symbol {
        Symbol::new(env, "wl_toks")
    }

    /// Admin-gated: add a token to the wager-asset whitelist (Issue #40).
    pub fn add_whitelisted_token(env: Env, token: Address) {
        let coordinator = Self::get_coordinator(env.clone());
        coordinator.require_auth();

        let key = Self::whitelist_key(&env);
        let mut tokens: Vec<Address> = env
            .storage()
            .instance()
            .get(&key)
            .unwrap_or_else(|| Vec::new(&env));

        if tokens.contains(&token) {
            panic_with_error!(&env, EscrowError::TokenAlreadyWhitelisted);
        }

        tokens.push_back(token.clone());
        env.storage().instance().set(&key, &tokens);
        env.storage()
            .instance()
            .set(&(Symbol::new(&env, "sup_tok"), token), &true);
    }

    /// Admin-gated: remove a token from the wager-asset whitelist (Issue #40).
    pub fn remove_whitelisted_token(env: Env, token: Address) {
        let coordinator = Self::get_coordinator(env.clone());
        coordinator.require_auth();

        let key = Self::whitelist_key(&env);
        let tokens: Vec<Address> = env
            .storage()
            .instance()
            .get(&key)
            .unwrap_or_else(|| Vec::new(&env));

        if !tokens.contains(&token) {
            panic_with_error!(&env, EscrowError::TokenNotWhitelisted);
        }

        let mut filtered = Vec::new(&env);
        for t in tokens.iter() {
            if t != token {
                filtered.push_back(t);
            }
        }
        env.storage().instance().set(&key, &filtered);
        env.storage()
            .instance()
            .remove(&(Symbol::new(&env, "sup_tok"), token));
    }

    /// Whether a token is currently whitelisted as a supported wager asset (Issue #40).
    pub fn is_token_whitelisted(env: Env, token: Address) -> bool {
        let key = Self::whitelist_key(&env);
        let tokens: Vec<Address> = env
            .storage()
            .instance()
            .get(&key)
            .unwrap_or_else(|| Vec::new(&env));
        tokens.contains(&token)
    }

    /// List all whitelisted wager-asset token addresses (Issue #40).
    pub fn get_whitelisted_tokens(env: Env) -> Vec<Address> {
        let key = Self::whitelist_key(&env);
        env.storage()
            .instance()
            .get(&key)
            .unwrap_or_else(|| Vec::new(&env))
    }

    fn filter_matches(env: &Env, matches: Vec<String>, remove_code: &String) -> Vec<String> {
        let mut filtered = Vec::new(env);
        for gc in matches.iter() {
            if gc != *remove_code {
                filtered.push_back(gc);
            }
        }
        filtered
    }

    fn bump_instance_ttl(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(STORAGE_TTL_THRESHOLD, STORAGE_TTL_EXTENDED);
    }

    fn bump_entry_ttl<K>(env: &Env, key: &K)
    where
        K: IntoVal<Env, Val>,
    {
        env.storage()
            .persistent()
            .extend_ttl(key, STORAGE_TTL_THRESHOLD, STORAGE_TTL_EXTENDED);
    }

    fn load_match(env: &Env, game_code: &String) -> Match {
        let m: Match = env
            .storage()
            .persistent()
            .get(game_code)
            .unwrap_or_else(|| panic_with_error!(env, EscrowError::MatchNotFound));
        Self::bump_entry_ttl(env, game_code);
        Self::bump_instance_ttl(env);
        m
    }

    fn remove_from_active_lists(env: &Env, game_code: &String, m: &Match) {
        let player1_key = (Symbol::new(env, "act_m"), m.player1.clone());
        let player1_matches: Vec<String> = env
            .storage()
            .persistent()
            .get(&player1_key)
            .unwrap_or_else(|| Vec::new(env));
        let filtered1 = Self::filter_matches(env, player1_matches, game_code);
        env.storage().persistent().set(&player1_key, &filtered1);
        Self::bump_entry_ttl(env, &player1_key);

        if let Some(p2) = m.player2.clone() {
            let player2_key = (Symbol::new(env, "act_m"), p2);
            let player2_matches: Vec<String> = env
                .storage()
                .persistent()
                .get(&player2_key)
                .unwrap_or_else(|| Vec::new(env));
            let filtered2 = Self::filter_matches(env, player2_matches, game_code);
            env.storage().persistent().set(&player2_key, &filtered2);
            Self::bump_entry_ttl(env, &player2_key);
        }
    }

    fn dispute_key(env: &Env, game_code: &String) -> (Symbol, String) {
        (Symbol::new(env, "dispute"), game_code.clone())
    }

    fn ensure_dispute_not_locked(env: &Env, game_code: &String) {
        let key = Self::dispute_key(env, game_code);
        if let Some(d) = env.storage().persistent().get::<_, Dispute>(&key) {
            if d.status == DisputeStatus::Locked {
                panic_with_error!(env, EscrowError::DisputeTimeLockActive);
            }
        }
    }

    fn validate_player_funds(env: &Env, token: &Address, owner: &Address, amount: i128) {
        let token_client = token::Client::new(env, token);
        if token_client.balance(owner) < amount {
            panic_with_error!(env, EscrowError::InsufficientFunds);
        }
        if token_client.allowance(owner, &env.current_contract_address()) < amount {
            panic_with_error!(env, EscrowError::InsufficientAllowance);
        }
    }

    fn validate_wager_amount(env: &Env, token: &Address, amount: i128) {
        if amount <= 0 {
            panic_with_error!(env, EscrowError::InvalidWager);
        }
        let limits = Self::get_token_wager_limits(env.clone(), token.clone());
        if amount < limits.min_wager {
            panic_with_error!(env, EscrowError::WagerBelowMinimum);
        }
        if amount > limits.max_wager {
            panic_with_error!(env, EscrowError::WagerAboveMaximum);
        }
    }

    /// Creates a match and deposits Player 1's wager (Issue #34).
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    /// * `game_code` - Unique match game code.
    /// * `player1` - Creator player address.
    /// * `token` - Token contract address.
    /// * `amount` - Wager amount.
    pub fn create_match(
        env: Env,
        game_code: String,
        player1: Address,
        token: Address,
        amount: i128,
    ) {
        player1.require_auth();

        if Self::is_paused(env.clone()) {
            panic_with_error!(&env, EscrowError::ContractPaused);
        }

        if !Self::is_token_supported(env.clone(), token.clone()) {
            panic_with_error!(&env, EscrowError::TokenNotWhitelisted);
        }

        let key = Self::whitelist_key(&env);
        if env.storage().instance().has(&key) {
            let whitelisted: Vec<Address> = env.storage().instance().get(&key).unwrap();
            if !whitelisted.contains(&token) {
                panic_with_error!(&env, EscrowError::TokenNotWhitelisted);
            }
        }

        if env.storage().persistent().has(&game_code) {
            panic_with_error!(&env, EscrowError::MatchAlreadyExists);
        }
        Self::validate_wager_amount(&env, &token, amount);

        let player1_key = (Symbol::new(&env, "act_m"), player1.clone());
        let active_matches: Vec<String> = env
            .storage()
            .persistent()
            .get(&player1_key)
            .unwrap_or_else(|| Vec::new(&env));

        if active_matches.len() >= 5 {
            panic_with_error!(&env, EscrowError::MaxActiveMatchesReached);
        }

        let current_nonce = Self::get_match_nonce(env.clone());
        let next_nonce = current_nonce + 1;
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "nonce"), &next_nonce);

        let token_client = token::Client::new(&env, &token);
        Self::validate_player_funds(&env, &token, &player1, amount);
        token_client.transfer(&player1, &env.current_contract_address(), &amount);

        let m = Match {
            game_code: game_code.clone(),
            player1: player1.clone(),
            player2: None,
            wager_amount: amount,
            total_staked: amount,
            created_at: env.ledger().timestamp(),
            status: MatchStatus::Pending,
            winner: None,
            token: token.clone(),
            nonce: next_nonce,
            cancel_requested_player1: false,
            cancel_requested_player2: false,
            draw_requested_player1: false,
            draw_requested_player2: false,
        };

        env.storage().persistent().set(&game_code, &m);
        Self::bump_entry_ttl(&env, &game_code);

        let mut updated_matches = active_matches.clone();
        updated_matches.push_back(game_code.clone());
        env.storage()
            .persistent()
            .set(&player1_key, &updated_matches);
        Self::bump_entry_ttl(&env, &player1_key);
        Self::bump_instance_ttl(&env);

        env.events().publish(
            (symbol_short!("created"), game_code.clone()),
            MatchCreatedEvent {
                game_code,
                player1,
                token,
                wager_amount: amount,
            },
        );
    }

    /// Joins an existing pending match and deposits Player 2's wager.
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    /// * `game_code` - Unique match game code.
    /// * `player2` - Joining player address.
    pub fn join_match(env: Env, game_code: String, player2: Address) {
        player2.require_auth();

        if Self::is_paused(env.clone()) {
            panic_with_error!(&env, EscrowError::ContractPaused);
        }

        let mut m = Self::load_match(&env, &game_code);

        if m.status != MatchStatus::Pending {
            panic_with_error!(&env, EscrowError::MatchNotPending);
        }

        let timeout = Self::get_match_timeout(env.clone());
        if env.ledger().timestamp() >= m.created_at + timeout {
            panic_with_error!(&env, EscrowError::MatchExpired);
        }

        if m.player2.is_some() {
            panic_with_error!(&env, EscrowError::AlreadyJoined);
        }
        if m.player1 == player2 {
            panic_with_error!(&env, EscrowError::CannotJoinOwnMatch);
        }

        let player2_key = (Symbol::new(&env, "act_m"), player2.clone());
        let active_matches: Vec<String> = env
            .storage()
            .persistent()
            .get(&player2_key)
            .unwrap_or_else(|| Vec::new(&env));

        if active_matches.len() >= 5 {
            panic_with_error!(&env, EscrowError::MaxActiveMatchesReached);
        }

        let token_client = token::Client::new(&env, &m.token);
        Self::validate_player_funds(&env, &m.token, &player2, m.wager_amount);
        token_client.transfer(&player2, &env.current_contract_address(), &m.wager_amount);

        m.player2 = Some(player2.clone());
        m.status = MatchStatus::Active;
        m.total_staked += m.wager_amount;

        env.storage().persistent().set(&game_code, &m);
        Self::bump_entry_ttl(&env, &game_code);

        let mut updated_matches = active_matches.clone();
        updated_matches.push_back(game_code.clone());
        env.storage()
            .persistent()
            .set(&player2_key, &updated_matches);
        Self::bump_entry_ttl(&env, &player2_key);

        env.events().publish(
            (symbol_short!("funded"), game_code.clone()),
            MatchFundedEvent {
                game_code,
                player2,
                total_staked: m.total_staked,
            },
        );
    }

    /// Places a spectator side bet on predicted match winner (Issue #35).
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    /// * `game_code` - Unique match game code.
    /// * `spectator` - Spectator address placing bet.
    /// * `predicted_winner` - Address of predicted winner.
    /// * `amount` - Staked bet amount.
    pub fn place_side_bet(
        env: Env,
        game_code: String,
        spectator: Address,
        predicted_winner: Address,
        amount: i128,
    ) {
        spectator.require_auth();
        if amount <= 0 {
            panic_with_error!(&env, EscrowError::InvalidWager);
        }

        let m = Self::load_match(&env, &game_code);

        if m.status != MatchStatus::Pending && m.status != MatchStatus::Active {
            panic_with_error!(&env, EscrowError::SideBetClosed);
        }

        let timeout = Self::get_match_timeout(env.clone());
        if env.ledger().timestamp() >= m.created_at + timeout {
            panic_with_error!(&env, EscrowError::MatchExpired);
        }

        if predicted_winner != m.player1 && Some(predicted_winner.clone()) != m.player2 {
            panic_with_error!(&env, EscrowError::InvalidWinner);
        }

        let token_client = token::Client::new(&env, &m.token);
        Self::validate_player_funds(&env, &m.token, &spectator, amount);
        token_client.transfer(&spectator, &env.current_contract_address(), &amount);

        let pool_key = (Symbol::new(&env, "side_p"), game_code.clone());
        let mut pool: SidePool = env
            .storage()
            .persistent()
            .get(&pool_key)
            .unwrap_or_else(|| SidePool {
                game_code: game_code.clone(),
                total_player1_side_staked: 0,
                total_player2_side_staked: 0,
                bets: Vec::new(&env),
            });

        if predicted_winner == m.player1 {
            pool.total_player1_side_staked += amount;
        } else {
            pool.total_player2_side_staked += amount;
        }

        pool.bets.push_back(SideBet {
            spectator,
            predicted_winner,
            amount,
        });

        env.storage().persistent().set(&pool_key, &pool);
        Self::bump_entry_ttl(&env, &pool_key);
    }

    /// Retrieves side bet pool details for a match (Issue #35).
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    /// * `game_code` - Unique match game code.
    ///
    /// # Returns
    /// * `SidePool` - Side pool details.
    pub fn get_side_pool(env: Env, game_code: String) -> SidePool {
        let pool_key = (Symbol::new(&env, "side_p"), game_code.clone());
        if env.storage().persistent().has(&pool_key) {
            Self::bump_entry_ttl(&env, &pool_key);
        }
        env.storage()
            .persistent()
            .get(&pool_key)
            .unwrap_or_else(|| SidePool {
                game_code: game_code.clone(),
                total_player1_side_staked: 0,
                total_player2_side_staked: 0,
                bets: Vec::new(&env),
            })
    }

    /// Requests mutual cancellation of match (Issue #37).
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    /// * `game_code` - Unique match game code.
    /// * `player` - Address of requesting player.
    pub fn request_cancellation(env: Env, game_code: String, player: Address) {
        player.require_auth();

        let mut m = Self::load_match(&env, &game_code);

        if m.status != MatchStatus::Pending && m.status != MatchStatus::Active {
            panic_with_error!(&env, EscrowError::AlreadyResolvedOrRefunded);
        }

        if player == m.player1 {
            m.cancel_requested_player1 = true;
        } else if Some(player.clone()) == m.player2 {
            m.cancel_requested_player2 = true;
        } else {
            panic_with_error!(&env, EscrowError::Unauthorized);
        }

        let is_canceled = if m.player2.is_none() {
            m.cancel_requested_player1
        } else {
            m.cancel_requested_player1 && m.cancel_requested_player2
        };

        if is_canceled {
            let token_client = token::Client::new(&env, &m.token);
            token_client.transfer(&env.current_contract_address(), &m.player1, &m.wager_amount);
            if let Some(p2) = m.player2.clone() {
                token_client.transfer(&env.current_contract_address(), &p2, &m.wager_amount);
            }

            let pool_key = (Symbol::new(&env, "side_p"), game_code.clone());
            if let Some(pool) = env.storage().persistent().get::<_, SidePool>(&pool_key) {
                for bet in pool.bets.iter() {
                    token_client.transfer(
                        &env.current_contract_address(),
                        &bet.spectator,
                        &bet.amount,
                    );
                }
                Self::bump_entry_ttl(&env, &pool_key);
            }

            m.status = MatchStatus::Refunded;
            Self::remove_from_active_lists(&env, &game_code, &m);

            env.events().publish(
                (symbol_short!("cancelled"), game_code.clone()),
                MatchCancelledEvent {
                    game_code: game_code.clone(),
                },
            );
        }

        env.storage().persistent().set(&game_code, &m);
        Self::bump_entry_ttl(&env, &game_code);
    }

    /// Instantly cancels an unjoined pending match created by Player 1 and returns deposit (Issue #20).
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    /// * `game_code` - Unique match game code.
    /// * `player1` - Creator player address.
    pub fn cancel_pending_match(env: Env, game_code: String, player1: Address) {
        player1.require_auth();

        let mut m = Self::load_match(&env, &game_code);

        if m.player1 != player1 {
            panic_with_error!(&env, EscrowError::Unauthorized);
        }
        if m.status != MatchStatus::Pending {
            panic_with_error!(&env, EscrowError::MatchNotPending);
        }
        if m.player2.is_some() {
            panic_with_error!(&env, EscrowError::AlreadyJoined);
        }

        let token_client = token::Client::new(&env, &m.token);
        token_client.transfer(&env.current_contract_address(), &m.player1, &m.wager_amount);

        let pool_key = (Symbol::new(&env, "side_p"), game_code.clone());
        if let Some(pool) = env.storage().persistent().get::<_, SidePool>(&pool_key) {
            for bet in pool.bets.iter() {
                token_client.transfer(
                    &env.current_contract_address(),
                    &bet.spectator,
                    &bet.amount,
                );
            }
            Self::bump_entry_ttl(&env, &pool_key);
        }

        m.status = MatchStatus::Refunded;
        Self::remove_from_active_lists(&env, &game_code, &m);

        env.storage().persistent().set(&game_code, &m);
        Self::bump_entry_ttl(&env, &game_code);

        env.events().publish(
            (symbol_short!("cancelled"), game_code.clone()),
            MatchCancelledEvent {
                game_code: game_code.clone(),
            },
        );
    }

    /// Requests a cooperative mutual draw for an active match (Issue #20).
    /// When both players agree to a draw, the match is resolved into a 50/50 refund draw.
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    /// * `game_code` - Unique match game code.
    /// * `player` - Address of requesting player.
    pub fn request_draw(env: Env, game_code: String, player: Address) {
        player.require_auth();

        let mut m = Self::load_match(&env, &game_code);

        if m.status != MatchStatus::Active {
            panic_with_error!(&env, EscrowError::MatchNotActive);
        }

        if player == m.player1 {
            m.draw_requested_player1 = true;
        } else if Some(player.clone()) == m.player2 {
            m.draw_requested_player2 = true;
        } else {
            panic_with_error!(&env, EscrowError::Unauthorized);
        }

        if m.draw_requested_player1 && m.draw_requested_player2 {
            let coordinator = Self::get_coordinator(env.clone());
            Self::settle_match(&env, &coordinator, &game_code, &mut m, None);

            env.events().publish(
                (symbol_short!("resolved"), game_code.clone()),
                MatchResolvedEvent {
                    game_code: game_code.clone(),
                    winner: None,
                    admin_fee: 0,
                },
            );
        } else {
            env.storage().persistent().set(&game_code, &m);
            Self::bump_entry_ttl(&env, &game_code);
        }
    }

    /// Retrieves cooperative draw request status for both players (Issue #20).
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    /// * `game_code` - Unique match game code.
    ///
    /// # Returns
    /// * `(bool, bool)` - Tuple of `(draw_requested_player1, draw_requested_player2)`.
    pub fn get_draw_status(env: Env, game_code: String) -> (bool, bool) {
        let m = Self::load_match(&env, &game_code);
        (m.draw_requested_player1, m.draw_requested_player2)
    }

    /// Coordinator resolves active match, distributing payouts and fee discounts (Issues #35 & #36).
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    /// * `game_code` - Unique match game code.
    /// * `winner` - Optional winner address, or None for a draw.
    pub fn resolve_match(env: Env, game_code: String, winner: Option<Address>) {
        let coordinator = Self::get_coordinator(env.clone());
        coordinator.require_auth();

        Self::ensure_dispute_not_locked(&env, &game_code);

        let mut m = Self::load_match(&env, &game_code);
        if m.status != MatchStatus::Active {
            panic_with_error!(&env, EscrowError::MatchNotActive);
        }

        let admin_fee = Self::settle_match(&env, &coordinator, &game_code, &mut m, winner.clone());

        env.events().publish(
            (symbol_short!("resolved"), game_code.clone()),
            MatchResolvedEvent {
                game_code,
                winner,
                admin_fee,
            },
        );
    }

    /// Coordinator forfeits an active match on behalf of a disconnected/timing out player (Issue #39).
    pub fn forfeit_match(env: Env, game_code: String, forfeiting_player: Address) {
        let coordinator = Self::get_coordinator(env.clone());
        coordinator.require_auth();

        Self::ensure_dispute_not_locked(&env, &game_code);

        let mut m = Self::load_match(&env, &game_code);
        if m.status != MatchStatus::Active {
            panic_with_error!(&env, EscrowError::MatchNotActive);
        }

        let p2 = m
            .player2
            .clone()
            .unwrap_or_else(|| panic_with_error!(&env, EscrowError::NotForfeitable));

        let winner = if forfeiting_player == m.player1 {
            p2
        } else if forfeiting_player == p2 {
            m.player1.clone()
        } else {
            panic_with_error!(&env, EscrowError::InvalidForfeitPlayer);
        };

        Self::settle_match(&env, &coordinator, &game_code, &mut m, Some(winner.clone()));

        env.events().publish(
            (symbol_short!("forfeited"), game_code.clone()),
            MatchForfeitedEvent {
                game_code,
                forfeiting_player,
                winner,
            },
        );
    }

    fn settle_match(
        env: &Env,
        coordinator: &Address,
        game_code: &String,
        m: &mut Match,
        winner: Option<Address>,
    ) -> i128 {
        let token_client = token::Client::new(env, &m.token);
        let mut admin_fee: i128 = 0;

        if let Some(w) = winner.clone() {
            if w != m.player1 && Some(w.clone()) != m.player2 {
                panic_with_error!(env, EscrowError::InvalidWinner);
            }

            let admin_bps = Self::get_effective_fee_bps(env.clone(), w.clone());
            admin_fee = (m.total_staked * (admin_bps as i128)) / 10000;
            let winner_pay = m.total_staked - admin_fee;

            token_client.transfer(&env.current_contract_address(), &w, &winner_pay);
            let fee_recipient = Self::get_treasury_vault(env.clone()).unwrap_or_else(|| coordinator.clone());
            token_client.transfer(&env.current_contract_address(), &fee_recipient, &admin_fee);
        } else {
            token_client.transfer(&env.current_contract_address(), &m.player1, &m.wager_amount);
            if let Some(p2) = m.player2.clone() {
                token_client.transfer(&env.current_contract_address(), &p2, &m.wager_amount);
            }
        }

        let pool_key = (Symbol::new(env, "side_p"), game_code.clone());
        if let Some(pool) = env.storage().persistent().get::<_, SidePool>(&pool_key) {
            if let Some(w) = winner.clone() {
                let winning_staked = if w == m.player1 {
                    pool.total_player1_side_staked
                } else {
                    pool.total_player2_side_staked
                };
                let total_side_staked =
                    pool.total_player1_side_staked + pool.total_player2_side_staked;

                if winning_staked > 0 {
                    for bet in pool.bets.iter() {
                        if bet.predicted_winner == w {
                            let payout = (bet.amount * total_side_staked) / winning_staked;
                            token_client.transfer(
                                &env.current_contract_address(),
                                &bet.spectator,
                                &payout,
                            );
                        }
                    }
                } else {
                    for bet in pool.bets.iter() {
                        token_client.transfer(
                            &env.current_contract_address(),
                            &bet.spectator,
                            &bet.amount,
                        );
                    }
                }
            } else {
                for bet in pool.bets.iter() {
                    token_client.transfer(
                        &env.current_contract_address(),
                        &bet.spectator,
                        &bet.amount,
                    );
                }
            }
            Self::bump_entry_ttl(env, &pool_key);
        }

        m.status = MatchStatus::Resolved;
        m.winner = winner;
        env.storage().persistent().set(game_code, m);
        Self::bump_entry_ttl(env, game_code);

        Self::remove_from_active_lists(env, game_code, m);
        admin_fee
    }

    /// Configures the match expiration timeout period in seconds (Coordinator only).
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    /// * `timeout_secs` - Timeout duration in seconds (must be > 0).
    pub fn set_match_timeout(env: Env, timeout_secs: u64) {
        let coordinator = Self::get_coordinator(env.clone());
        coordinator.require_auth();

        if timeout_secs == 0 {
            panic_with_error!(&env, EscrowError::InvalidWager);
        }

        env.storage()
            .instance()
            .set(&Symbol::new(&env, "timeout"), &timeout_secs);
        Self::bump_instance_ttl(&env);
    }

    /// Retrieves current match expiration timeout period in seconds.
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    ///
    /// # Returns
    /// * `u64` - Match timeout duration in seconds (defaults to `MATCH_EXPIRATION_SECS`).
    pub fn get_match_timeout(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&Symbol::new(&env, "timeout"))
            .unwrap_or(MATCH_EXPIRATION_SECS)
    }

    /// Checks whether a match has expired based on current ledger timestamp.
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    /// * `game_code` - Unique match game code.
    ///
    /// # Returns
    /// * `bool` - True if match is in Pending or Active status and ledger timestamp >= created_at + timeout.
    pub fn is_match_expired(env: Env, game_code: String) -> bool {
        let m = Self::load_match(&env, &game_code);
        if m.status != MatchStatus::Pending && m.status != MatchStatus::Active {
            return false;
        }
        let timeout = Self::get_match_timeout(env.clone());
        env.ledger().timestamp() >= m.created_at + timeout
    }

    /// Retrieves ledger expiration timestamp for a match.
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    /// * `game_code` - Unique match game code.
    ///
    /// # Returns
    /// * `u64` - Expiration timestamp (`created_at + timeout`).
    pub fn get_match_expiration(env: Env, game_code: String) -> u64 {
        let m = Self::load_match(&env, &game_code);
        let timeout = Self::get_match_timeout(env.clone());
        m.created_at + timeout
    }

    /// Allows a match player (player1 or player2) to claim refund after expiration timeout (Issue #21).
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    /// * `game_code` - Unique match game code.
    /// * `player` - Address of player claiming refund (must be participant).
    pub fn claim_refund(env: Env, game_code: String, player: Address) {
        player.require_auth();

        let mut m = Self::load_match(&env, &game_code);

        if player != m.player1 && Some(player.clone()) != m.player2 {
            panic_with_error!(&env, EscrowError::Unauthorized);
        }

        if m.status == MatchStatus::Resolved || m.status == MatchStatus::Refunded {
            panic_with_error!(&env, EscrowError::AlreadyResolvedOrRefunded);
        }

        Self::ensure_dispute_not_locked(&env, &game_code);

        let timeout = Self::get_match_timeout(env.clone());
        if env.ledger().timestamp() < m.created_at + timeout {
            panic_with_error!(&env, EscrowError::TimeoutNotReached);
        }

        Self::execute_refund(&env, &game_code, &mut m);
    }

    /// Auto-claims refund on an expired match by coordinator or participant (Issue #21).
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    /// * `game_code` - Unique match game code.
    /// * `caller` - Caller address (must be coordinator or match participant).
    pub fn auto_claim_refund(env: Env, game_code: String, caller: Address) {
        caller.require_auth();

        let mut m = Self::load_match(&env, &game_code);
        let coordinator = Self::get_coordinator(env.clone());

        if caller != coordinator && caller != m.player1 && Some(caller.clone()) != m.player2 {
            panic_with_error!(&env, EscrowError::Unauthorized);
        }

        if m.status == MatchStatus::Resolved || m.status == MatchStatus::Refunded {
            panic_with_error!(&env, EscrowError::AlreadyResolvedOrRefunded);
        }

        Self::ensure_dispute_not_locked(&env, &game_code);

        let timeout = Self::get_match_timeout(env.clone());
        if env.ledger().timestamp() < m.created_at + timeout {
            panic_with_error!(&env, EscrowError::TimeoutNotReached);
        }

        Self::execute_refund(&env, &game_code, &mut m);
    }

    /// Coordinator batch auto-claims refunds for multiple expired matches (Issue #21).
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    /// * `game_codes` - Vector of match game codes to evaluate and refund if expired.
    ///
    /// # Returns
    /// * `u32` - Number of expired matches successfully refunded.
    pub fn auto_claim_expired_matches(env: Env, game_codes: Vec<String>) -> u32 {
        let coordinator = Self::get_coordinator(env.clone());
        coordinator.require_auth();

        let mut count: u32 = 0;
        let now = env.ledger().timestamp();
        let timeout = Self::get_match_timeout(env.clone());

        for game_code in game_codes.iter() {
            if let Some(mut m) = env.storage().persistent().get::<_, Match>(&game_code) {
                if (m.status == MatchStatus::Pending || m.status == MatchStatus::Active)
                    && now >= m.created_at + timeout
                {
                    let dispute_key = Self::dispute_key(&env, &game_code);
                    if let Some(d) = env.storage().persistent().get::<_, Dispute>(&dispute_key) {
                        if d.status == DisputeStatus::Locked {
                            continue;
                        }
                    }

                    Self::execute_refund(&env, &game_code, &mut m);
                    count += 1;
                }
            }
        }
        count
    }

    /// Refunds match wagers after match expiration timeout period.
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    /// * `game_code` - Unique match game code.
    pub fn refund_after_timeout(env: Env, game_code: String) {
        let mut m = Self::load_match(&env, &game_code);

        if m.status == MatchStatus::Resolved || m.status == MatchStatus::Refunded {
            panic_with_error!(&env, EscrowError::AlreadyResolvedOrRefunded);
        }

        Self::ensure_dispute_not_locked(&env, &game_code);

        let timeout = Self::get_match_timeout(env.clone());
        if env.ledger().timestamp() < m.created_at + timeout {
            panic_with_error!(&env, EscrowError::TimeoutNotReached);
        }

        Self::execute_refund(&env, &game_code, &mut m);
    }

    fn execute_refund(env: &Env, game_code: &String, m: &mut Match) {
        let token_client = token::Client::new(env, &m.token);

        token_client.transfer(&env.current_contract_address(), &m.player1, &m.wager_amount);
        if let Some(p2) = m.player2.clone() {
            token_client.transfer(&env.current_contract_address(), &p2, &m.wager_amount);
        }

        let pool_key = (Symbol::new(env, "side_p"), game_code.clone());
        if let Some(pool) = env.storage().persistent().get::<_, SidePool>(&pool_key) {
            for bet in pool.bets.iter() {
                token_client.transfer(&env.current_contract_address(), &bet.spectator, &bet.amount);
            }
            Self::bump_entry_ttl(env, &pool_key);
        }

        m.status = MatchStatus::Refunded;
        env.storage().persistent().set(game_code, m);
        Self::bump_entry_ttl(env, game_code);

        Self::remove_from_active_lists(env, game_code, m);

        env.events().publish(
            (symbol_short!("refunded"), game_code.clone()),
            MatchRefundedEvent {
                game_code: game_code.clone(),
            },
        );
        env.events().publish(
            (symbol_short!("expired"), game_code.clone()),
            MatchExpiredEvent {
                game_code: game_code.clone(),
            },
        );
    }

    /// Retrieves details for a specific match.
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    /// * `game_code` - Unique match game code.
    ///
    /// # Returns
    /// * `Match` - Match struct details.
    pub fn get_match(env: Env, game_code: String) -> Match {
        Self::load_match(&env, &game_code)
    }

    /// Retrieves cancellation request status for both players (Issue #37).
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    /// * `game_code` - Unique match game code.
    ///
    /// # Returns
    /// * `(bool, bool)` - Tuple of `(cancel_requested_player1, cancel_requested_player2)`.
    pub fn get_cancellation_status(env: Env, game_code: String) -> (bool, bool) {
        let m = Self::load_match(&env, &game_code);
        (m.cancel_requested_player1, m.cancel_requested_player2)
    }

    /// Raises a dispute on active match, locking funds into 48-hour timelock queue (Issue #27).
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    /// * `game_code` - Unique match game code.
    /// * `player` - Address of player raising dispute.
    pub fn raise_dispute(env: Env, game_code: String, player: Address) {
        player.require_auth();

        let m = Self::load_match(&env, &game_code);

        if m.status != MatchStatus::Active {
            panic_with_error!(&env, EscrowError::MatchNotActive);
        }
        if player != m.player1 && Some(player.clone()) != m.player2 {
            panic_with_error!(&env, EscrowError::Unauthorized);
        }

        let key = Self::dispute_key(&env, &game_code);
        if env.storage().persistent().has(&key) {
            panic_with_error!(&env, EscrowError::AlreadyDisputed);
        }

        let created_at = env.ledger().timestamp();
        let dispute = Dispute {
            game_code: game_code.clone(),
            raised_by: player,
            created_at,
            release_at: created_at + DISPUTE_TIMELOCK_SECS,
            status: DisputeStatus::Locked,
        };

        env.storage().persistent().set(&key, &dispute);
        Self::bump_entry_ttl(&env, &key);
    }

    /// Retrieves dispute details for a match.
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    /// * `game_code` - Unique match game code.
    ///
    /// # Returns
    /// * `Dispute` - Dispute struct details.
    pub fn get_dispute(env: Env, game_code: String) -> Dispute {
        let key = Self::dispute_key(&env, &game_code);
        env.storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, EscrowError::DisputeNotFound))
    }

    /// Coordinator arbitrates disputed match after 48-hour timelock expiration (Issue #27).
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    /// * `game_code` - Unique match game code.
    /// * `winner` - Optional winner address, or None for draw.
    pub fn resolve_dispute(env: Env, game_code: String, winner: Option<Address>) {
        let coordinator = Self::get_coordinator(env.clone());
        coordinator.require_auth();

        let key = Self::dispute_key(&env, &game_code);
        let mut dispute: Dispute = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, EscrowError::DisputeNotFound));

        if dispute.status != DisputeStatus::Locked {
            panic_with_error!(&env, EscrowError::AlreadyResolvedOrRefunded);
        }
        if env.ledger().timestamp() < dispute.release_at {
            panic_with_error!(&env, EscrowError::DisputeTimeLockActive);
        }

        let mut m = Self::load_match(&env, &game_code);
        Self::settle_match(&env, &coordinator, &game_code, &mut m, winner);

        dispute.status = DisputeStatus::Settled;
        env.storage().persistent().set(&key, &dispute);
        Self::bump_entry_ttl(&env, &key);
    }

    /// Coordinator resolves up to `MAX_BATCH_RESOLUTIONS` matches in a single atomic transaction (Issue #23).
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    /// * `resolutions` - Vector of match resolutions.
    pub fn batch_resolve_matches(env: Env, resolutions: Vec<BatchResolution>) {
        let coordinator = Self::get_coordinator(env.clone());
        coordinator.require_auth();

        let len = resolutions.len();
        if resolutions.is_empty() || len > MAX_BATCH_RESOLUTIONS {
            panic_with_error!(&env, EscrowError::InvalidBatchSize);
        }

        for resolution in resolutions.iter() {
            Self::ensure_dispute_not_locked(&env, &resolution.game_code);
            let mut m = Self::load_match(&env, &resolution.game_code);
            Self::settle_match(
                &env,
                &coordinator,
                &resolution.game_code,
                &mut m,
                resolution.winner.clone(),
            );
        }
    }

    /// Cleans up settled or refunded matches older than 30 days (`STALE_MATCH_THRESHOLD_SECS`) from storage (Issue #41).
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    /// * `game_codes` - Vector of game codes to evaluate for garbage collection.
    ///
    /// # Returns
    /// * `u32` - Number of stale match storage entries removed.
    pub fn gc_stale_matches(env: Env, game_codes: Vec<String>) -> u32 {
        let coordinator = Self::get_coordinator(env.clone());
        coordinator.require_auth();

        let mut cleaned: u32 = 0;
        let now = env.ledger().timestamp();

        for game_code in game_codes.iter() {
            if Self::gc_stale_match_internal(&env, &game_code, now) {
                cleaned += 1;
            }
        }
        cleaned
    }

    /// Single match garbage collection helper that removes a settled or refunded match older than 30 days (Issue #41).
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    /// * `game_code` - Game code string.
    ///
    /// # Returns
    /// * `bool` - True if storage entry was removed, false otherwise.
    pub fn gc_stale_match(env: Env, game_code: String) -> bool {
        let coordinator = Self::get_coordinator(env.clone());
        coordinator.require_auth();

        let now = env.ledger().timestamp();
        Self::gc_stale_match_internal(&env, &game_code, now)
    }

    fn gc_stale_match_internal(env: &Env, game_code: &String, now: u64) -> bool {
        if let Some(m) = env.storage().persistent().get::<_, Match>(game_code) {
            if (m.status == MatchStatus::Resolved || m.status == MatchStatus::Refunded)
                && now >= m.created_at + STALE_MATCH_THRESHOLD_SECS
            {
                env.storage().persistent().remove(game_code);

                let pool_key = (Symbol::new(env, "side_p"), game_code.clone());
                if env.storage().persistent().has(&pool_key) {
                    env.storage().persistent().remove(&pool_key);
                }
                return true;
            }
        }
        false
    }

    /// Creates a tournament prize pool.
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    /// * `tournament_id` - Unique tournament identifier.
    /// * `buy_in_amount` - Required buy-in amount per player.
    /// * `prize_distribution` - Vector of prize amounts.
    /// * `token` - Token address used for tournament pool.
    pub fn create_tournament(
        env: Env,
        tournament_id: String,
        buy_in_amount: i128,
        prize_distribution: Vec<i128>,
        token: Address,
    ) {
        if Self::is_paused(env.clone()) {
            panic_with_error!(&env, EscrowError::ContractPaused);
        }

        if !Self::is_token_supported(env.clone(), token.clone()) {
            panic_with_error!(&env, EscrowError::TokenNotWhitelisted);
        }
        let key = Self::whitelist_key(&env);
        if env.storage().instance().has(&key) {
            let whitelisted: Vec<Address> = env.storage().instance().get(&key).unwrap();
            if !whitelisted.contains(&token) {
                panic_with_error!(&env, EscrowError::TokenNotWhitelisted);
            }
        }
        if env.storage().persistent().has(&tournament_id) {
            panic_with_error!(&env, EscrowError::InvalidTournament);
        }
        if buy_in_amount <= 0 {
            panic_with_error!(&env, EscrowError::InvalidWager);
        }

        let tournament = TournamentPrizePool {
            tournament_id: tournament_id.clone(),
            players: Vec::new(&env),
            buy_in_amount,
            total_pool: 0,
            prize_distribution,
            final_rankings: Vec::new(&env),
            status: TournamentStatus::Open,
            created_at: env.ledger().timestamp(),
            token,
        };

        env.storage().persistent().set(&tournament_id, &tournament);
        Self::bump_entry_ttl(&env, &tournament_id);
    }

    /// Joins an open tournament.
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    /// * `tournament_id` - Unique tournament identifier.
    /// * `player` - Joining player address.
    pub fn join_tournament(env: Env, tournament_id: String, player: Address) {
        player.require_auth();

        if Self::is_paused(env.clone()) {
            panic_with_error!(&env, EscrowError::ContractPaused);
        }

        let mut tournament: TournamentPrizePool = env
            .storage()
            .persistent()
            .get(&tournament_id)
            .unwrap_or_else(|| panic_with_error!(&env, EscrowError::InvalidTournament));
        Self::bump_entry_ttl(&env, &tournament_id);

        if tournament.status != TournamentStatus::Open {
            panic_with_error!(&env, EscrowError::InvalidTournament);
        }

        if tournament.players.contains(&player) {
            panic_with_error!(&env, EscrowError::AlreadyJoined);
        }

        let token_client = token::Client::new(&env, &tournament.token);
        Self::validate_player_funds(&env, &tournament.token, &player, tournament.buy_in_amount);
        token_client.transfer(
            &player,
            &env.current_contract_address(),
            &tournament.buy_in_amount,
        );

        tournament.players.push_back(player);
        tournament.total_pool += tournament.buy_in_amount;

        env.storage().persistent().set(&tournament_id, &tournament);
        Self::bump_entry_ttl(&env, &tournament_id);
    }

    /// Completes tournament with final rankings and distributes prize payouts.
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    /// * `tournament_id` - Unique tournament identifier.
    /// * `final_rankings` - Vector of ranked player addresses.
    pub fn complete_tournament(env: Env, tournament_id: String, final_rankings: Vec<Address>) {
        let coordinator = Self::get_coordinator(env.clone());
        coordinator.require_auth();

        let mut tournament: TournamentPrizePool = env
            .storage()
            .persistent()
            .get(&tournament_id)
            .unwrap_or_else(|| panic_with_error!(&env, EscrowError::InvalidTournament));
        Self::bump_entry_ttl(&env, &tournament_id);

        if tournament.status != TournamentStatus::Open {
            panic_with_error!(&env, EscrowError::InvalidTournament);
        }

        if final_rankings.len() != tournament.players.len() {
            panic_with_error!(&env, EscrowError::InvalidTournament);
        }

        let token_client = token::Client::new(&env, &tournament.token);

        for (i, winner) in final_rankings.iter().enumerate() {
            if (i as u32) < tournament.prize_distribution.len() {
                let prize = tournament.prize_distribution.get(i as u32).unwrap_or(0);
                if prize > 0 {
                    token_client.transfer(&env.current_contract_address(), &winner, &prize);
                }
            }
        }

        tournament.status = TournamentStatus::Completed;
        tournament.final_rankings = final_rankings;

        env.storage().persistent().set(&tournament_id, &tournament);
        Self::bump_entry_ttl(&env, &tournament_id);
    }

    /// Retrieves tournament details.
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    /// * `tournament_id` - Unique tournament identifier.
    ///
    /// # Returns
    /// * `TournamentPrizePool` - Tournament details struct.
    pub fn get_tournament(env: Env, tournament_id: String) -> TournamentPrizePool {
        let tournament: TournamentPrizePool = env
            .storage()
            .persistent()
            .get(&tournament_id)
            .unwrap_or_else(|| panic_with_error!(&env, EscrowError::InvalidTournament));
        Self::bump_entry_ttl(&env, &tournament_id);
        tournament
    }

    /// Updates the Elo rating for a player.
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    /// * `player` - Address of the player.
    /// * `new_elo` - New Elo rating.
    pub fn update_player_elo(env: Env, player: Address, new_elo: u32) {
        player.require_auth();
        env.storage()
            .persistent()
            .set(&(symbol_short!("elo_r"), player.clone()), &new_elo);
        env.storage().persistent().extend_ttl(
            &(symbol_short!("elo_r"), player.clone()),
            STORAGE_TTL_THRESHOLD,
            STORAGE_TTL_EXTENDED,
        );
        env.events().publish(
            (symbol_short!("elo_r"), player.clone()),
            PlayerEloUpdatedEvent { player, new_elo },
        );
    }

    /// Retrieves the Elo rating for a player. Defaults to 1200 if not set.
    ///
    /// # Arguments
    /// * `env` - Environment reference.
    /// * `player` - Address of the player.
    ///
    /// # Returns
    /// * `u32` - Elo rating.
    pub fn get_player_elo(env: Env, player: Address) -> u32 {
        let elo = env
            .storage()
            .persistent()
            .get(&(symbol_short!("elo_r"), player.clone()))
            .unwrap_or(1200u32);

        if env
            .storage()
            .persistent()
            .has(&(symbol_short!("elo_r"), player.clone()))
        {
            env.storage().persistent().extend_ttl(
                &(symbol_short!("elo_r"), player),
                STORAGE_TTL_THRESHOLD,
                STORAGE_TTL_EXTENDED,
            );
        }
        elo
    }
}

mod test;
