#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env, String, Vec};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
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
            .set(&soroban_sdk::symbol_short!("coord"), &coordinator);
        env.storage()
            .instance()
            .set(&soroban_sdk::symbol_short!("fee"), &admin_bps);
    }

    /// Get coordinator address
    pub fn get_coordinator(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&soroban_sdk::symbol_short!("coord"))
            .expect("Not initialized")
    }

    /// Get admin fee in basis points
    pub fn get_fee_bps(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&soroban_sdk::symbol_short!("fee"))
            .unwrap_or(500)
    }

    /// Get treasury balance (total contract balance)
    pub fn get_treasury(env: Env, token: Address) -> i128 {
        let token_client = token::Client::new(&env, &token);
        token_client.balance(&env.current_contract_address())
    }

    fn get_player_matches_key(env: &Env, player: &Address) -> String {
        let mut key_str = String::from_str(env, "active_matches:");
        key_str.append(&player.to_string());
        key_str
    }

    /// Player 1 creates a match and deposits the wager
    pub fn create_match(
        env: Env,
        game_code: String,
        player1: Address,
        token: Address,
        amount: i128,
    ) {
        player1.require_auth();

        if env.storage().persistent().has(&game_code) {
            panic!("{}", (EscrowError::MatchAlreadyExists as u32).to_string());
        }
        if amount <= 0 {
            panic!("{}", (EscrowError::InvalidWager as u32).to_string());
        }

        let player1_key = Self::get_player_matches_key(&env, &player1);
        let active_matches: Vec<String> = env
            .storage()
            .persistent()
            .get(&player1_key)
            .unwrap_or(Vec::new(&env));

        if active_matches.len() >= 5 {
            panic!("{}", (EscrowError::MaxActiveMatchesReached as u32).to_string());
        }

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
        };

        env.storage().persistent().set(&game_code, &m);

        let mut updated_matches = active_matches.clone();
        updated_matches.push_back(game_code.clone());
        env.storage().persistent().set(&player1_key, &updated_matches);
    }

    /// Player 2 joins an existing match and deposits the wager
    pub fn join_match(env: Env, game_code: String, player2: Address) {
        player2.require_auth();

        let mut m: Match = env
            .storage()
            .persistent()
            .get(&game_code)
            .expect("Match not found");

        if m.status != MatchStatus::Pending {
            panic!("{}", (EscrowError::MatchNotPending as u32).to_string());
        }
        if m.player2.is_some() {
            panic!("{}", (EscrowError::AlreadyJoined as u32).to_string());
        }
        if m.player1 == player2 {
            panic!("{}", (EscrowError::CannotJoinOwnMatch as u32).to_string());
        }

        let player2_key = Self::get_player_matches_key(&env, &player2);
        let active_matches: Vec<String> = env
            .storage()
            .persistent()
            .get(&player2_key)
            .unwrap_or(Vec::new(&env));

        if active_matches.len() >= 5 {
            panic!("{}", (EscrowError::MaxActiveMatchesReached as u32).to_string());
        }

        let token_client = token::Client::new(&env, &m.token);
        token_client.transfer(&player2, &env.current_contract_address(), &m.wager_amount);

        m.player2 = Some(player2.clone());
        m.status = MatchStatus::Active;
        m.total_staked += m.wager_amount;

        env.storage().persistent().set(&game_code, &m);

        let mut updated_matches = active_matches.clone();
        updated_matches.push_back(game_code.clone());
        env.storage().persistent().set(&player2_key, &updated_matches);
    }

    /// Coordinator resolves the match
    pub fn resolve_match(env: Env, game_code: String, winner: Option<Address>) {
        let coordinator: Address = env
            .storage()
            .instance()
            .get(&soroban_sdk::symbol_short!("coord"))
            .expect("Not initialized");
        coordinator.require_auth();

        let mut m: Match = env
            .storage()
            .persistent()
            .get(&game_code)
            .expect("Match not found");

        if m.status != MatchStatus::Active {
            panic!("{}", (EscrowError::MatchNotActive as u32).to_string());
        }

        let token_client = token::Client::new(&env, &m.token);

        if let Some(w) = winner.clone() {
            if w != m.player1 && Some(w.clone()) != m.player2 {
                panic!("{}", (EscrowError::InvalidWinner as u32).to_string());
            }

            let admin_bps: u32 = env
                .storage()
                .instance()
                .get(&soroban_sdk::symbol_short!("fee"))
                .unwrap_or(500);
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

        m.status = MatchStatus::Resolved;
        m.winner = winner;
        env.storage().persistent().set(&game_code, &m);

        let player1_key = Self::get_player_matches_key(&env, &m.player1);
        let mut player1_matches: Vec<String> = env
            .storage()
            .persistent()
            .get(&player1_key)
            .unwrap_or(Vec::new(&env));
        player1_matches.retain(|gc| gc != &game_code);
        env.storage().persistent().set(&player1_key, &player1_matches);

        if let Some(p2) = m.player2.clone() {
            let player2_key = Self::get_player_matches_key(&env, &p2);
            let mut player2_matches: Vec<String> = env
                .storage()
                .persistent()
                .get(&player2_key)
                .unwrap_or(Vec::new(&env));
            player2_matches.retain(|gc| gc != &game_code);
            env.storage().persistent().set(&player2_key, &player2_matches);
        }
    }

    /// Refund after timeout (1 hour)
    pub fn refund_after_timeout(env: Env, game_code: String) {
        let mut m: Match = env
            .storage()
            .persistent()
            .get(&game_code)
            .expect("Match not found");

        if m.status == MatchStatus::Resolved || m.status == MatchStatus::Refunded {
            panic!("{}", (EscrowError::AlreadyResolvedOrRefunded as u32).to_string());
        }

        if env.ledger().timestamp() < m.created_at + 3600 {
            panic!("{}", (EscrowError::TimeoutNotReached as u32).to_string());
        }

        let token_client = token::Client::new(&env, &m.token);

        token_client.transfer(&env.current_contract_address(), &m.player1, &m.wager_amount);
        if let Some(p2) = m.player2.clone() {
            token_client.transfer(&env.current_contract_address(), &p2, &m.wager_amount);
        }

        m.status = MatchStatus::Refunded;
        env.storage().persistent().set(&game_code, &m);

        let player1_key = Self::get_player_matches_key(&env, &m.player1);
        let mut player1_matches: Vec<String> = env
            .storage()
            .persistent()
            .get(&player1_key)
            .unwrap_or(Vec::new(&env));
        player1_matches.retain(|gc| gc != &game_code);
        env.storage().persistent().set(&player1_key, &player1_matches);

        if let Some(p2) = m.player2.clone() {
            let player2_key = Self::get_player_matches_key(&env, &p2);
            let mut player2_matches: Vec<String> = env
                .storage()
                .persistent()
                .get(&player2_key)
                .unwrap_or(Vec::new(&env));
            player2_matches.retain(|gc| gc != &game_code);
            env.storage().persistent().set(&player2_key, &player2_matches);
        }
    }

    /// Get match details
    pub fn get_match(env: Env, game_code: String) -> Match {
        env.storage()
            .persistent()
            .get(&game_code)
            .expect("Match not found")
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
            panic!("{}", (EscrowError::InvalidTournament as u32).to_string());
        }
        if buy_in_amount <= 0 {
            panic!("{}", (EscrowError::InvalidWager as u32).to_string());
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
            .expect("Tournament not found");

        if tournament.status != TournamentStatus::Open {
            panic!("{}", (EscrowError::InvalidTournament as u32).to_string());
        }

        if tournament.players.contains(&player) {
            panic!("{}", (EscrowError::AlreadyJoined as u32).to_string());
        }

        let token_client = token::Client::new(&env, &tournament.token);
        token_client.transfer(&player, &env.current_contract_address(), &tournament.buy_in_amount);

        tournament.players.push_back(player);
        tournament.total_pool += tournament.buy_in_amount;

        env.storage().persistent().set(&tournament_id, &tournament);
    }

    /// Complete tournament with final rankings and distribute prizes
    pub fn complete_tournament(env: Env, tournament_id: String, final_rankings: Vec<Address>) {
        let coordinator: Address = env
            .storage()
            .instance()
            .get(&soroban_sdk::symbol_short!("coord"))
            .expect("Not initialized");
        coordinator.require_auth();

        let mut tournament: TournamentPrizePool = env
            .storage()
            .persistent()
            .get(&tournament_id)
            .expect("Tournament not found");

        if tournament.status != TournamentStatus::Open {
            panic!("{}", (EscrowError::InvalidTournament as u32).to_string());
        }

        if final_rankings.len() != tournament.players.len() {
            panic!("{}", (EscrowError::InvalidTournament as u32).to_string());
        }

        let token_client = token::Client::new(&env, &tournament.token);

        for (i, winner) in final_rankings.iter().enumerate() {
            if i < tournament.prize_distribution.len() {
                let prize = tournament.prize_distribution.get(i as u32).unwrap_or(0);
                if prize > 0 {
                    token_client.transfer(&env.current_contract_address(), winner, &prize);
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
            .expect("Tournament not found")
    }
}

mod test;
