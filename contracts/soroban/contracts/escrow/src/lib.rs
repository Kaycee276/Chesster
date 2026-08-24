#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, token,
    Address, Env, String, Symbol, Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum EscrowError {
    NotInitialized = 0,
    MatchNotFound = 1,
    MatchAlreadyExists = 2,
    InvalidWager = 3,
    MatchNotPending = 4,
    AlreadyJoined = 5,
    CannotJoinOwnMatch = 6,
    MatchNotActive = 7,
    InvalidWinner = 8,
    AlreadyResolvedOrRefunded = 9,
    TimeoutNotReached = 10,
    Unauthorized = 11,
    InsufficientFunds = 12,
    MaxActiveMatchesReached = 13,
    InvalidTournament = 14,
    SideBetNotFound = 15,
    SideBetClosed = 16,
    CancellationAlreadyRequested = 17,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MatchStatus {
    Pending = 0,
    Active = 1,
    Resolved = 2,
    Refunded = 3,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TournamentStatus {
    Open = 0,
    Active = 1,
    Completed = 2,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SideBet {
    pub spectator: Address,
    pub predicted_winner: Address,
    pub amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SidePool {
    pub game_code: String,
    pub total_player1_side_staked: i128,
    pub total_player2_side_staked: i128,
    pub bets: Vec<SideBet>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TournamentPrizePool {
    pub tournament_id: String,
    pub players: Vec<Address>,
    pub buy_in_amount: i128,
    pub total_pool: i128,
    pub prize_distribution: Vec<i128>,
    pub final_rankings: Vec<Address>,
    pub status: TournamentStatus,
    pub created_at: u64,
    pub token: Address,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Match {
    pub game_code: String,
    pub player1: Address,
    pub player2: Option<Address>,
    pub wager_amount: i128,
    pub total_staked: i128,
    pub created_at: u64,
    pub status: MatchStatus,
    pub winner: Option<Address>,
    pub token: Address,
    pub nonce: u64,
    pub cancel_requested_player1: bool,
    pub cancel_requested_player2: bool,
}

#[contract]
pub struct ChessterEscrow;

#[contractimpl]
impl ChessterEscrow {
    /// Initialize the contract with the coordinator address and admin fee (in basis points)
    pub fn init(env: Env, coordinator: Address, admin_bps: u32) {
        coordinator.require_auth();
        env.storage()
            .instance()
            .set(&symbol_short!("coord"), &coordinator);
        env.storage()
            .instance()
            .set(&symbol_short!("fee"), &admin_bps);
    }

    /// Set governance token address for fee discounts (Issue #36)
    pub fn set_gov_token(env: Env, gov_token: Address) {
        let coordinator = Self::get_coordinator(env.clone());
        coordinator.require_auth();
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "gov_tok"), &gov_token);
    }

    /// Get governance token address
    pub fn get_gov_token(env: Env) -> Option<Address> {
        env.storage().instance().get(&Symbol::new(&env, "gov_tok"))
    }

    /// Get effective fee basis points for a user considering governance token holdings (Issue #36)
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

    /// Get current match creation nonce counter (Issue #34)
    pub fn get_match_nonce(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&Symbol::new(&env, "nonce"))
            .unwrap_or(0)
    }

    /// Get coordinator address
    pub fn get_coordinator(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&symbol_short!("coord"))
            .unwrap_or_else(|| panic_with_error!(&env, EscrowError::NotInitialized))
    }

    /// Get admin fee in basis points
    pub fn get_fee_bps(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&symbol_short!("fee"))
            .unwrap_or(500)
    }

    /// Get treasury balance (total contract balance)
    pub fn get_treasury(env: Env, token: Address) -> i128 {
        let token_client = token::Client::new(&env, &token);
        token_client.balance(&env.current_contract_address())
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

    /// Player 1 creates a match and deposits the wager (Issue #34: Increments Nonce)
    pub fn create_match(
        env: Env,
        game_code: String,
        player1: Address,
        token: Address,
        amount: i128,
    ) {
        player1.require_auth();

        if env.storage().persistent().has(&game_code) {
            panic_with_error!(&env, EscrowError::MatchAlreadyExists);
        }
        if amount <= 0 {
            panic_with_error!(&env, EscrowError::InvalidWager);
        }

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
            token,
            nonce: next_nonce,
            cancel_requested_player1: false,
            cancel_requested_player2: false,
        };

        env.storage().persistent().set(&game_code, &m);

        let mut updated_matches = active_matches.clone();
        updated_matches.push_back(game_code.clone());
        env.storage()
            .persistent()
            .set(&player1_key, &updated_matches);
    }

    /// Player 2 joins an existing match and deposits the wager
    pub fn join_match(env: Env, game_code: String, player2: Address) {
        player2.require_auth();

        let mut m: Match = env
            .storage()
            .persistent()
            .get(&game_code)
            .unwrap_or_else(|| panic_with_error!(&env, EscrowError::MatchNotFound));

        if m.status != MatchStatus::Pending {
            panic_with_error!(&env, EscrowError::MatchNotPending);
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
        token_client.transfer(&player2, &env.current_contract_address(), &m.wager_amount);

        m.player2 = Some(player2.clone());
        m.status = MatchStatus::Active;
        m.total_staked += m.wager_amount;

        env.storage().persistent().set(&game_code, &m);

        let mut updated_matches = active_matches.clone();
        updated_matches.push_back(game_code.clone());
        env.storage()
            .persistent()
            .set(&player2_key, &updated_matches);
    }

    /// Spectators place side bets on match outcome (Issue #35)
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

        let m: Match = env
            .storage()
            .persistent()
            .get(&game_code)
            .unwrap_or_else(|| panic_with_error!(&env, EscrowError::MatchNotFound));

        if m.status != MatchStatus::Pending && m.status != MatchStatus::Active {
            panic_with_error!(&env, EscrowError::SideBetClosed);
        }

        if predicted_winner != m.player1 && Some(predicted_winner.clone()) != m.player2 {
            panic_with_error!(&env, EscrowError::InvalidWinner);
        }

        let token_client = token::Client::new(&env, &m.token);
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
    }

    /// Get side pool for a match (Issue #35)
    pub fn get_side_pool(env: Env, game_code: String) -> SidePool {
        let pool_key = (Symbol::new(&env, "side_p"), game_code.clone());
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

    /// Request mutual cancellation of match (Issue #37)
    pub fn request_cancellation(env: Env, game_code: String, player: Address) {
        player.require_auth();

        let mut m: Match = env
            .storage()
            .persistent()
            .get(&game_code)
            .unwrap_or_else(|| panic_with_error!(&env, EscrowError::MatchNotFound));

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

            // Refund any side pool bets
            let pool_key = (Symbol::new(&env, "side_p"), game_code.clone());
            if let Some(pool) = env.storage().persistent().get::<_, SidePool>(&pool_key) {
                for bet in pool.bets.iter() {
                    token_client.transfer(
                        &env.current_contract_address(),
                        &bet.spectator,
                        &bet.amount,
                    );
                }
            }

            m.status = MatchStatus::Refunded;

            let player1_key = (Symbol::new(&env, "act_m"), m.player1.clone());
            let player1_matches: Vec<String> = env
                .storage()
                .persistent()
                .get(&player1_key)
                .unwrap_or_else(|| Vec::new(&env));
            let filtered1 = Self::filter_matches(&env, player1_matches, &game_code);
            env.storage().persistent().set(&player1_key, &filtered1);

            if let Some(p2) = m.player2.clone() {
                let player2_key = (Symbol::new(&env, "act_m"), p2);
                let player2_matches: Vec<String> = env
                    .storage()
                    .persistent()
                    .get(&player2_key)
                    .unwrap_or_else(|| Vec::new(&env));
                let filtered2 = Self::filter_matches(&env, player2_matches, &game_code);
                env.storage().persistent().set(&player2_key, &filtered2);
            }
        }

        env.storage().persistent().set(&game_code, &m);
    }

    /// Get cancellation status for match (Issue #37)
    pub fn get_cancellation_status(env: Env, game_code: String) -> (bool, bool) {
        let m: Match = env
            .storage()
            .persistent()
            .get(&game_code)
            .unwrap_or_else(|| panic_with_error!(&env, EscrowError::MatchNotFound));
        (m.cancel_requested_player1, m.cancel_requested_player2)
    }

    /// Coordinator resolves the match (Includes Fee Discount #36 and Side Pool Payout #35)
    pub fn resolve_match(env: Env, game_code: String, winner: Option<Address>) {
        let coordinator = Self::get_coordinator(env.clone());
        coordinator.require_auth();

        let mut m: Match = env
            .storage()
            .persistent()
            .get(&game_code)
            .unwrap_or_else(|| panic_with_error!(&env, EscrowError::MatchNotFound));

        if m.status != MatchStatus::Active {
            panic_with_error!(&env, EscrowError::MatchNotActive);
        }

        let token_client = token::Client::new(&env, &m.token);

        if let Some(w) = winner.clone() {
            if w != m.player1 && Some(w.clone()) != m.player2 {
                panic_with_error!(&env, EscrowError::InvalidWinner);
            }

            // Fee calculation with governance token discount (#36)
            let admin_bps = Self::get_effective_fee_bps(env.clone(), w.clone());
            let admin_fee = (m.total_staked * (admin_bps as i128)) / 10000;
            let winner_pay = m.total_staked - admin_fee;

            token_client.transfer(&env.current_contract_address(), &w, &winner_pay);
            token_client.transfer(&env.current_contract_address(), &coordinator, &admin_fee);
        } else {
            token_client.transfer(&env.current_contract_address(), &m.player1, &m.wager_amount);
            if let Some(p2) = m.player2.clone() {
                token_client.transfer(&env.current_contract_address(), &p2, &m.wager_amount);
            }
        }

        // Process Side Pool Payout (#35)
        let pool_key = (Symbol::new(&env, "side_p"), game_code.clone());
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
                    // No spectator bet on actual winner: refund all bets
                    for bet in pool.bets.iter() {
                        token_client.transfer(
                            &env.current_contract_address(),
                            &bet.spectator,
                            &bet.amount,
                        );
                    }
                }
            } else {
                // Draw: refund all bets
                for bet in pool.bets.iter() {
                    token_client.transfer(
                        &env.current_contract_address(),
                        &bet.spectator,
                        &bet.amount,
                    );
                }
            }
        }

        m.status = MatchStatus::Resolved;
        m.winner = winner;
        env.storage().persistent().set(&game_code, &m);

        let player1_key = (Symbol::new(&env, "act_m"), m.player1.clone());
        let player1_matches: Vec<String> = env
            .storage()
            .persistent()
            .get(&player1_key)
            .unwrap_or_else(|| Vec::new(&env));
        let filtered1 = Self::filter_matches(&env, player1_matches, &game_code);
        env.storage().persistent().set(&player1_key, &filtered1);

        if let Some(p2) = m.player2.clone() {
            let player2_key = (Symbol::new(&env, "act_m"), p2);
            let player2_matches: Vec<String> = env
                .storage()
                .persistent()
                .get(&player2_key)
                .unwrap_or_else(|| Vec::new(&env));
            let filtered2 = Self::filter_matches(&env, player2_matches, &game_code);
            env.storage().persistent().set(&player2_key, &filtered2);
        }
    }

    /// Refund after timeout (1 hour)
    pub fn refund_after_timeout(env: Env, game_code: String) {
        let mut m: Match = env
            .storage()
            .persistent()
            .get(&game_code)
            .unwrap_or_else(|| panic_with_error!(&env, EscrowError::MatchNotFound));

        if m.status == MatchStatus::Resolved || m.status == MatchStatus::Refunded {
            panic_with_error!(&env, EscrowError::AlreadyResolvedOrRefunded);
        }

        if env.ledger().timestamp() < m.created_at + 3600 {
            panic_with_error!(&env, EscrowError::TimeoutNotReached);
        }

        let token_client = token::Client::new(&env, &m.token);

        token_client.transfer(&env.current_contract_address(), &m.player1, &m.wager_amount);
        if let Some(p2) = m.player2.clone() {
            token_client.transfer(&env.current_contract_address(), &p2, &m.wager_amount);
        }

        // Refund any side pool bets
        let pool_key = (Symbol::new(&env, "side_p"), game_code.clone());
        if let Some(pool) = env.storage().persistent().get::<_, SidePool>(&pool_key) {
            for bet in pool.bets.iter() {
                token_client.transfer(&env.current_contract_address(), &bet.spectator, &bet.amount);
            }
        }

        m.status = MatchStatus::Refunded;
        env.storage().persistent().set(&game_code, &m);

        let player1_key = (Symbol::new(&env, "act_m"), m.player1.clone());
        let player1_matches: Vec<String> = env
            .storage()
            .persistent()
            .get(&player1_key)
            .unwrap_or_else(|| Vec::new(&env));
        let filtered1 = Self::filter_matches(&env, player1_matches, &game_code);
        env.storage().persistent().set(&player1_key, &filtered1);

        if let Some(p2) = m.player2.clone() {
            let player2_key = (Symbol::new(&env, "act_m"), p2);
            let player2_matches: Vec<String> = env
                .storage()
                .persistent()
                .get(&player2_key)
                .unwrap_or_else(|| Vec::new(&env));
            let filtered2 = Self::filter_matches(&env, player2_matches, &game_code);
            env.storage().persistent().set(&player2_key, &filtered2);
        }
    }

    /// Get match details
    pub fn get_match(env: Env, game_code: String) -> Match {
        env.storage()
            .persistent()
            .get(&game_code)
            .unwrap_or_else(|| panic_with_error!(&env, EscrowError::MatchNotFound))
    }

    /// Create a tournament prize pool
    pub fn create_tournament(
        env: Env,
        tournament_id: String,
        buy_in_amount: i128,
        prize_distribution: Vec<i128>,
        token: Address,
    ) {
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
    }

    /// Join a tournament
    pub fn join_tournament(env: Env, tournament_id: String, player: Address) {
        player.require_auth();

        let mut tournament: TournamentPrizePool = env
            .storage()
            .persistent()
            .get(&tournament_id)
            .unwrap_or_else(|| panic_with_error!(&env, EscrowError::InvalidTournament));

        if tournament.status != TournamentStatus::Open {
            panic_with_error!(&env, EscrowError::InvalidTournament);
        }

        if tournament.players.contains(&player) {
            panic_with_error!(&env, EscrowError::AlreadyJoined);
        }

        let token_client = token::Client::new(&env, &tournament.token);
        token_client.transfer(
            &player,
            &env.current_contract_address(),
            &tournament.buy_in_amount,
        );

        tournament.players.push_back(player);
        tournament.total_pool += tournament.buy_in_amount;

        env.storage().persistent().set(&tournament_id, &tournament);
    }

    /// Complete tournament with final rankings and distribute prizes
    pub fn complete_tournament(env: Env, tournament_id: String, final_rankings: Vec<Address>) {
        let coordinator = Self::get_coordinator(env.clone());
        coordinator.require_auth();

        let mut tournament: TournamentPrizePool = env
            .storage()
            .persistent()
            .get(&tournament_id)
            .unwrap_or_else(|| panic_with_error!(&env, EscrowError::InvalidTournament));

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
    }

    /// Get tournament details
    pub fn get_tournament(env: Env, tournament_id: String) -> TournamentPrizePool {
        env.storage()
            .persistent()
            .get(&tournament_id)
            .unwrap_or_else(|| panic_with_error!(&env, EscrowError::InvalidTournament))
    }
}

mod test;
