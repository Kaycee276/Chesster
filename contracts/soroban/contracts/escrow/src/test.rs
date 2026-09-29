#![cfg(test)]

extern crate alloc;

use super::*;
use soroban_sdk::token::Client as TokenClient;
use soroban_sdk::token::StellarAssetClient as TokenAdminClient;
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    vec, Address, Env, String,
};

fn create_token_contract<'a>(e: &Env, admin: &Address) -> (TokenClient<'a>, TokenAdminClient<'a>) {
    let contract_id = e.register_stellar_asset_contract_v2(admin.clone());
    (
        TokenClient::new(e, &contract_id.address()),
        TokenAdminClient::new(e, &contract_id.address()),
    )
}

/// Grant a player a token allowance for the escrow contract (Issue #26).
fn approve(e: &Env, token: &TokenClient, owner: &Address, spender: &Address, amount: i128) {
    token.approve(owner, spender, &amount, &(e.ledger().sequence() + 1_000));
}

#[test]
fn test_create_and_join_match() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);

    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500); // 5% fee
    client.add_whitelisted_token(&token.address);

    let game_code = String::from_str(&env, "GAME123");

    // Player 1 creates match
    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);

    assert_eq!(token.balance(&player1), 900);
    assert_eq!(token.balance(&contract_id), 100);

    let match_data = client.get_match(&game_code);
    assert_eq!(match_data.status, MatchStatus::Pending);
    assert_eq!(match_data.wager_amount, 100);
    assert_eq!(match_data.nonce, 1); // Issue #34 Nonce test

    // Player 2 joins match
    client.join_match(&game_code, &player2);

    assert_eq!(token.balance(&player2), 900);
    assert_eq!(token.balance(&contract_id), 200);

    let match_data = client.get_match(&game_code);
    assert_eq!(match_data.status, MatchStatus::Active);
    assert_eq!(match_data.total_staked, 200);
}

#[test]
fn test_match_nonce_increments() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &10000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    assert_eq!(client.get_match_nonce(), 0);

    approve(&env, &token, &player1, &contract_id, 10000);

    let game_1 = String::from_str(&env, "GAME_NONCE_1");
    client.create_match(&game_1, &player1, &token.address, &100);
    assert_eq!(client.get_match_nonce(), 1);

    let game_2 = String::from_str(&env, "GAME_NONCE_2");
    client.create_match(&game_2, &player1, &token.address, &100);
    assert_eq!(client.get_match_nonce(), 2);
}

#[test]
fn test_resolve_match_winner() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500); // 5% fee
    client.add_whitelisted_token(&token.address);

    let game_code = String::from_str(&env, "GAME123");
    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);

    client.resolve_match(&game_code, &Some(player1.clone()));

    let match_data = client.get_match(&game_code);
    assert_eq!(match_data.status, MatchStatus::Resolved);
    assert_eq!(match_data.winner, Some(player1.clone()));

    assert_eq!(token.balance(&player1), 1090);
    assert_eq!(token.balance(&coordinator), 10);
    assert_eq!(token.balance(&contract_id), 0);
}

#[test]
fn test_governance_token_fee_discount() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    let (gov_token, gov_token_admin_client) = create_token_contract(&env, &token_admin);

    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);
    gov_token_admin_client.mint(&player1, &10000); // Holds 10,000 gov tokens -> 50% discount

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500); // 5% fee base (500 bps)
    client.add_whitelisted_token(&token.address);
    client.set_gov_token(&gov_token.address);

    assert_eq!(client.get_gov_token(), Some(gov_token.address.clone()));
    assert_eq!(client.get_effective_fee_bps(&player1), 250); // 50% discount -> 250 bps (2.5%)

    let game_code = String::from_str(&env, "GAME_DISCOUNT");
    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);

    // Resolve match: total staked = 200. Fee = 2.5% of 200 = 5. Winner gets 195.
    client.resolve_match(&game_code, &Some(player1.clone()));

    assert_eq!(token.balance(&player1), 1095);
    assert_eq!(token.balance(&coordinator), 5);
}

#[test]
fn test_spectator_side_pool_payout() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let spectator1 = Address::generate(&env);
    let spectator2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);
    token_admin_client.mint(&spectator1, &500);
    token_admin_client.mint(&spectator2, &500);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    let game_code = String::from_str(&env, "GAME_BET");
    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    approve(&env, &token, &spectator1, &contract_id, 500);
    approve(&env, &token, &spectator2, &contract_id, 500);
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);

    // Spectator 1 bets 100 on Player 1
    client.place_side_bet(&game_code, &spectator1, &player1, &100);
    // Spectator 2 bets 100 on Player 2
    client.place_side_bet(&game_code, &spectator2, &player2, &100);

    let side_pool = client.get_side_pool(&game_code);
    assert_eq!(side_pool.total_player1_side_staked, 100);
    assert_eq!(side_pool.total_player2_side_staked, 100);
    assert_eq!(side_pool.bets.len(), 2);

    // Resolve match with Player 1 winning
    // Total side pool = 200. Winning side staked = 100.
    // Spectator 1 gets (100 * 200) / 100 = 200.
    client.resolve_match(&game_code, &Some(player1.clone()));

    assert_eq!(token.balance(&spectator1), 600); // 400 + 200 = 600
    assert_eq!(token.balance(&spectator2), 400); // 500 - 100 = 400
}

#[test]
fn test_mutual_cancellation() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    let game_code = String::from_str(&env, "GAME_CANCEL");
    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);

    // Player 1 requests cancellation
    client.request_cancellation(&game_code, &player1);
    let (c1, c2) = client.get_cancellation_status(&game_code);
    assert!(c1);
    assert!(!c2);
    assert_eq!(client.get_match(&game_code).status, MatchStatus::Active);

    // Player 2 requests cancellation -> triggers full refund
    client.request_cancellation(&game_code, &player2);
    let match_data = client.get_match(&game_code);
    assert_eq!(match_data.status, MatchStatus::Refunded);

    assert_eq!(token.balance(&player1), 1000);
    assert_eq!(token.balance(&player2), 1000);
    assert_eq!(token.balance(&contract_id), 0);
}

#[test]
fn test_resolve_match_draw() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    let game_code = String::from_str(&env, "GAME123");
    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);

    client.resolve_match(&game_code, &None);

    let match_data = client.get_match(&game_code);
    assert_eq!(match_data.status, MatchStatus::Resolved);
    assert_eq!(match_data.winner, None);

    assert_eq!(token.balance(&player1), 1000);
    assert_eq!(token.balance(&player2), 1000);
    assert_eq!(token.balance(&contract_id), 0);
}

#[test]
fn test_refund_after_timeout() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    let game_code = String::from_str(&env, "GAME123");

    env.ledger().with_mut(|li| {
        li.timestamp = 1000;
    });

    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);

    env.ledger().with_mut(|li| {
        li.timestamp = 4601;
    });

    client.refund_after_timeout(&game_code);

    let match_data = client.get_match(&game_code);
    assert_eq!(match_data.status, MatchStatus::Refunded);

    assert_eq!(token.balance(&player1), 1000);
    assert_eq!(token.balance(&player2), 1000);
    assert_eq!(token.balance(&contract_id), 0);
}

#[test]
#[should_panic(expected = "HostError")]
fn test_refund_before_timeout_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    let game_code = String::from_str(&env, "GAME123");

    env.ledger().with_mut(|li| {
        li.timestamp = 1000;
    });

    approve(&env, &token, &player1, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);

    env.ledger().with_mut(|li| {
        li.timestamp = 2000;
    });

    client.refund_after_timeout(&game_code);
}

#[test]
fn test_get_coordinator_and_fee_bps() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, _token_admin_client) = create_token_contract(&env, &token_admin);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_supported_token(&token.address);

    assert_eq!(client.get_coordinator(), coordinator);
    assert_eq!(client.get_fee_bps(), 500);
}

#[test]
fn test_get_treasury() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    let game_code = String::from_str(&env, "GAME123");
    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);

    assert_eq!(client.get_treasury(&token.address), 200);
}

#[test]
#[should_panic(expected = "HostError")]
fn test_max_active_matches() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &10000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    let g0 = String::from_str(&env, "GAME0");
    approve(&env, &token, &player1, &contract_id, 10000);
    let g1 = String::from_str(&env, "GAME1");
    let g2 = String::from_str(&env, "GAME2");
    let g3 = String::from_str(&env, "GAME3");
    let g4 = String::from_str(&env, "GAME4");
    client.create_match(&g0, &player1, &token.address, &100);
    client.create_match(&g1, &player1, &token.address, &100);
    client.create_match(&g2, &player1, &token.address, &100);
    client.create_match(&g3, &player1, &token.address, &100);
    client.create_match(&g4, &player1, &token.address, &100);

    let game_6 = String::from_str(&env, "GAME6");
    client.create_match(&game_6, &player1, &token.address, &100);
}

#[test]
fn test_tournament_create_and_join() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_supported_token(&token.address);

    let tournament_id = String::from_str(&env, "TOURNAMENT1");

    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    client.create_tournament(&tournament_id, &100, &8, &2, &0, &token.address);

    client.join_tournament(&tournament_id, &player1);
    client.join_tournament(&tournament_id, &player2);

    let tournament = client.get_tournament(&tournament_id);
    assert_eq!(tournament.total_pool, 200);
    assert_eq!(tournament.players.len(), 2);
}

#[test]
fn test_tournament_complete() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.set_tournament_fee_bps(&500);
    client.add_supported_token(&token.address);

    let tournament_id = String::from_str(&env, "TOURNAMENT1");

    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    client.create_tournament(&tournament_id, &100, &8, &2, &0, &token.address);
    client.join_tournament(&tournament_id, &player1);
    client.join_tournament(&tournament_id, &player2);

    let winners = vec![&env, player1.clone(), player2.clone()];
    let payout_bps = vec![&env, 7000_u32, 3000_u32];
    client.complete_tournament(&tournament_id, &winners, &payout_bps);

    let tournament = client.get_tournament(&tournament_id);
    assert_eq!(tournament.status, TournamentStatus::Completed);
    // Total pool 200. Fee 500 bps (5%) = 10 tokens to coordinator. Net pool = 190.
    // 1st place: 190 * 7000 / 10000 = 133. Player 1: 1000 - 100 + 133 = 1033.
    // 2nd place: 190 - 133 = 57. Player 2: 1000 - 100 + 57 = 957.
    assert_eq!(token.balance(&player1), 1033);
    assert_eq!(token.balance(&player2), 957);
    assert_eq!(token.balance(&coordinator), 10);
}

#[test]
fn test_tournament_eight_player_payout_conserves_pool() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let treasury_vault = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let players = [
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
    ];

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    for player in &players {
        token_admin_client.mint(player, &100);
    }

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);
    client.set_treasury_vault(&treasury_vault);
    client.set_tournament_fee_bps(&500);
    client.add_supported_token(&token.address);

    for player in &players {
        approve(&env, &token, player, &contract_id, 10);
    }

    let tournament_id = String::from_str(&env, "TOURN_EIGHT_PLAYERS");
    client.create_tournament(&tournament_id, &10, &8, &2, &0, &token.address);
    for player in &players {
        client.join_tournament(&tournament_id, player);
    }

    let active = client.get_tournament(&tournament_id);
    assert_eq!(active.status, TournamentStatus::Active);
    assert_eq!(active.players.len(), 8);
    assert_eq!(active.total_pool, 80);
    assert_eq!(token.balance(&contract_id), 80);

    let winners = vec![&env, players[0].clone(), players[1].clone()];
    let payout_bps = vec![&env, 7000_u32, 3000_u32];
    client.complete_tournament(&tournament_id, &winners, &payout_bps);

    // 80 pool - 5% fee (4) = 76 prize pool; integer remainder goes to second place.
    assert_eq!(token.balance(&players[0]), 143);
    assert_eq!(token.balance(&players[1]), 113);
    for player in players.iter().skip(2) {
        assert_eq!(token.balance(player), 90);
    }
    assert_eq!(token.balance(&treasury_vault), 4);
    assert_eq!(token.balance(&contract_id), 0);
    assert_eq!(client.get_escrowed_balance(&token.address), 0);
}

#[test]
fn test_tournament_rejects_duplicate_and_full_registration() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let p1 = Address::generate(&env);
    let p2 = Address::generate(&env);
    let p3 = Address::generate(&env);
    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    for player in [&p1, &p2, &p3] {
        token_admin_client.mint(player, &100);
    }

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &0);
    client.add_supported_token(&token.address);
    for player in [&p1, &p2, &p3] {
        approve(&env, &token, player, &contract_id, 10);
    }

    let tournament_id = String::from_str(&env, "TOURN_ERRORS");
    client.create_tournament(&tournament_id, &10, &2, &2, &0, &token.address);
    client.join_tournament(&tournament_id, &p1);
    let duplicate = client.try_join_tournament(&tournament_id, &p1);
    assert!(duplicate.is_err());
    client.join_tournament(&tournament_id, &p2);
    let full = client.try_join_tournament(&tournament_id, &p3);
    assert!(full.is_err());
}

#[test]
fn test_tournament_completion_requires_coordinator_auth() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player, &100);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &0);
    client.add_supported_token(&token.address);
    approve(&env, &token, &player, &contract_id, 10);
    let tournament_id = String::from_str(&env, "TOURN_AUTH");
    client.create_tournament(&tournament_id, &10, &2, &1, &0, &token.address);
    client.join_tournament(&tournament_id, &player);

    env.set_auths(&[]);
    let winners = vec![&env, player];
    let payout_bps = vec![&env, 10000_u32];
    let unauthorized = client.try_complete_tournament(&tournament_id, &winners, &payout_bps);
    assert!(unauthorized.is_err());
}

#[test]
fn test_tournament_prize_pool_lifecycle() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let p1 = Address::generate(&env);
    let p2 = Address::generate(&env);
    let p3 = Address::generate(&env);
    let p4 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&p1, &1000);
    token_admin_client.mint(&p2, &1000);
    token_admin_client.mint(&p3, &1000);
    token_admin_client.mint(&p4, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &250); // 2.5% platform fee
    client.set_tournament_fee_bps(&250);
    client.add_supported_token(&token.address);

    let tournament_id = String::from_str(&env, "TOURN_MULTI_WINNER");

    approve(&env, &token, &p1, &contract_id, 1000);
    approve(&env, &token, &p2, &contract_id, 1000);
    approve(&env, &token, &p3, &contract_id, 1000);
    approve(&env, &token, &p4, &contract_id, 1000);

    client.create_tournament(&tournament_id, &200, &4, &2, &1000, &token.address);

    client.join_tournament(&tournament_id, &p1);
    client.join_tournament(&tournament_id, &p2);
    client.join_tournament(&tournament_id, &p3);
    client.join_tournament(&tournament_id, &p4);

    let t = client.get_tournament(&tournament_id);
    assert_eq!(t.total_pool, 800);
    assert_eq!(t.status, TournamentStatus::Active);
    assert_eq!(client.get_escrowed_balance(&token.address), 800);

    // Invalid payout BPS sum check (9000 != 10000)
    let bad_bps = vec![&env, 5000_u32, 3000_u32, 1000_u32];
    let bad_winners = vec![&env, p1.clone(), p2.clone(), p3.clone()];
    let res = client.try_complete_tournament(&tournament_id, &bad_winners, &bad_bps);
    assert!(res.is_err());

    // Valid distribution: 50%, 30%, 20%
    let winners = vec![&env, p1.clone(), p2.clone(), p3.clone()];
    let payout_bps = vec![&env, 5000_u32, 3000_u32, 2000_u32];
    client.complete_tournament(&tournament_id, &winners, &payout_bps);

    let completed = client.get_tournament(&tournament_id);
    assert_eq!(completed.status, TournamentStatus::Completed);
    // Total pool: 800. Rake: 2.5% = 20. Net pool = 780.
    // P1: 50% = 390 -> 1000 - 200 + 390 = 1190.
    // P2: 30% = 234 -> 1000 - 200 + 234 = 1034.
    // P3: 20% = 156 -> 1000 - 200 + 156 = 956.
    // P4: 0%  = 0   -> 1000 - 200 = 800.
    // Coordinator: 20.
    assert_eq!(token.balance(&p1), 1190);
    assert_eq!(token.balance(&p2), 1034);
    assert_eq!(token.balance(&p3), 956);
    assert_eq!(token.balance(&p4), 800);
    assert_eq!(token.balance(&coordinator), 20);
    assert_eq!(client.get_escrowed_balance(&token.address), 0);
    assert_eq!(token.balance(&contract_id), 0);
}

#[test]
fn test_tournament_refund_workflow() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let p1 = Address::generate(&env);
    let p2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&p1, &1000);
    token_admin_client.mint(&p2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);
    client.add_supported_token(&token.address);

    // Scenario 1: Coordinator cancels tournament
    let tourn_cancel = String::from_str(&env, "TOURN_CANCEL");
    approve(&env, &token, &p1, &contract_id, 1000);
    client.create_tournament(&tourn_cancel, &200, &4, &2, &1000, &token.address);
    client.join_tournament(&tourn_cancel, &p1);
    assert_eq!(token.balance(&p1), 800);
    assert_eq!(client.get_escrowed_balance(&token.address), 200);

    client.cancel_tournament(&tourn_cancel);
    let t = client.get_tournament(&tourn_cancel);
    assert_eq!(t.status, TournamentStatus::Cancelled);

    // Non-participant cannot claim
    let err_unauth = client.try_claim_tournament_refund(&tourn_cancel, &p2);
    assert!(err_unauth.is_err());

    // P1 claims refund
    assert!(!client.is_refund_claimed(&tourn_cancel, &p1));
    client.claim_tournament_refund(&tourn_cancel, &p1);
    assert_eq!(token.balance(&p1), 1000);
    assert!(client.is_refund_claimed(&tourn_cancel, &p1));
    assert_eq!(client.get_escrowed_balance(&token.address), 0);

    // Double refund fails
    let err_double = client.try_claim_tournament_refund(&tourn_cancel, &p1);
    assert!(err_double.is_err());

    // Scenario 2: Quorum failure triggers self-service refund past deadline
    env.ledger().set_timestamp(100);
    let tourn_quorum = String::from_str(&env, "TOURN_QUORUM");
    approve(&env, &token, &p2, &contract_id, 1000);
    client.create_tournament(&tourn_quorum, &150, &4, &3, &500, &token.address);
    client.join_tournament(&tourn_quorum, &p1);
    client.join_tournament(&tourn_quorum, &p2);

    assert_eq!(token.balance(&p1), 850);
    assert_eq!(token.balance(&p2), 850);
    assert_eq!(client.get_escrowed_balance(&token.address), 300);

    // Prior to deadline, refund cannot be claimed without cancellation
    let err_early = client.try_claim_tournament_refund(&tourn_quorum, &p1);
    assert!(err_early.is_err());

    // Advance timestamp past deadline
    env.ledger().set_timestamp(600);

    // Self-service refund succeeds and sets status to Cancelled
    client.claim_tournament_refund(&tourn_quorum, &p1);
    assert_eq!(token.balance(&p1), 1000);
    assert_eq!(
        client.get_tournament(&tourn_quorum).status,
        TournamentStatus::Cancelled
    );

    client.claim_tournament_refund(&tourn_quorum, &p2);
    assert_eq!(token.balance(&p2), 1000);
    assert_eq!(client.get_escrowed_balance(&token.address), 0);
    assert_eq!(token.balance(&contract_id), 0);
}

// ---------------------------------------------------------------------------
// Issue #221 â€” Tournament Tiered Rake & Treasury Protocol Fee Deduction
// ---------------------------------------------------------------------------

#[test]
fn test_tournament_fee_deduction() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let treasury_vault = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_supported_token(&token.address);
    client.set_treasury_vault(&treasury_vault);

    // Initial fee defaults to 0
    assert_eq!(client.get_tournament_fee_bps(), 0);

    // Verify calculate_tournament_rake pure logic
    let (net, rake) = client.calculate_tournament_rake(&1000, &500);
    assert_eq!(rake, 50);
    assert_eq!(net, 950);

    // Set tournament fee to 500 BPS (5%)
    client.set_tournament_fee_bps(&500);
    assert_eq!(client.get_tournament_fee_bps(), 500);

    let tournament_id = String::from_str(&env, "TOURN_FEE_1");
    let payout_bps = vec![&env, 7500_u32, 2500_u32];

    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    client.create_tournament(&tournament_id, &100, &8, &2, &0, &token.address);
    client.join_tournament(&tournament_id, &player1);
    client.join_tournament(&tournament_id, &player2);

    let tournament_before = client.get_tournament(&tournament_id);
    assert_eq!(tournament_before.total_pool, 200);

    let final_rankings = vec![&env, player1.clone(), player2.clone()];
    client.complete_tournament(&tournament_id, &final_rankings, &payout_bps);

    // total_pool = 200, rake = 200 * 500 / 10000 = 10
    // net_prize_pool = 190
    // w1 share = (150 * 190) / 200 = 142
    // w2 share = 190 - 142 = 48
    // treasury balance = 10 (rake)
    assert_eq!(token.balance(&treasury_vault), 10);
    // player1: spent 100 (balance 900) + received 142 = 1042
    assert_eq!(token.balance(&player1), 1042);
    // player2: spent 100 (balance 900) + received 48 = 948
    assert_eq!(token.balance(&player2), 948);

    // Verify zero token leakage or dust accumulation in the escrow contract balance
    assert_eq!(token.balance(&contract_id), 0);
    // Verify conservation: 10 + 142 + 48 == 200
    assert_eq!(
        10 + (token.balance(&player1) - 900) + (token.balance(&player2) - 900),
        200
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn test_set_tournament_fee_bps_rejects_above_cap() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);

    // Attempting to set fee > 500 BPS must panic with InvalidWager (error #3)
    client.set_tournament_fee_bps(&501);
}

// ---------------------------------------------------------------------------
// Issue #222 â€” Tournament Stage Checkpoints and Disqualification Slashing
// ---------------------------------------------------------------------------

#[test]
fn test_disqualification_and_redistribution() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let treasury_vault = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_supported_token(&token.address);
    client.set_treasury_vault(&treasury_vault);

    let tournament_id = String::from_str(&env, "TOURN_DQ_1");
    let payout_bps = vec![&env, 7500_u32, 2500_u32];

    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    client.create_tournament(&tournament_id, &100, &8, &2, &0, &token.address);
    client.join_tournament(&tournament_id, &player1);
    client.join_tournament(&tournament_id, &player2);

    // Record stage checkpoint
    client.record_stage_checkpoint(&tournament_id, &2);
    let tournament_stg = client.get_tournament(&tournament_id);
    assert_eq!(tournament_stg.stage, 2);

    // Disqualify player1 (cheating / forfeit reason code 99)
    client.disqualify_participant(&tournament_id, &player1, &99);
    let tournament_dq = client.get_tournament(&tournament_id);
    assert!(tournament_dq.disqualified.get(player1.clone()).unwrap());

    // Complete tournament with player1 ranked 1st and player2 ranked 2nd
    let final_rankings = vec![&env, player1.clone(), player2.clone()];
    client.complete_tournament(&tournament_id, &final_rankings, &payout_bps);

    // Player1 was disqualified: prize (150) must NOT be received by player1,
    // but slashed and transferred directly to treasury
    assert_eq!(token.balance(&player1), 900); // Spent 100 on buy-in, receives 0 prize
    assert_eq!(token.balance(&player2), 950); // Spent 100 on buy-in, receives 50 prize
    assert_eq!(token.balance(&treasury_vault), 150); // Slashed prize routed to treasury

    // Escrow contract balance must be strictly 0 (no dust, complete conservation)
    assert_eq!(token.balance(&contract_id), 0);
}

// ---------------------------------------------------------------------------
// Issue #40 â€” Multi-Token Whitelist Registry
// ---------------------------------------------------------------------------

#[test]
fn test_whitelist_add_remove_and_query() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token, _admin_client) = create_token_contract(&env, &token_admin);
    let (other_token, _admin_client2) = create_token_contract(&env, &token_admin);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);

    assert!(!client.is_token_whitelisted(&token.address));
    assert_eq!(client.get_whitelisted_tokens().len(), 0);

    client.add_whitelisted_token(&token.address);
    assert!(client.is_token_whitelisted(&token.address));
    assert!(!client.is_token_whitelisted(&other_token.address));
    assert_eq!(client.get_whitelisted_tokens().len(), 1);

    client.add_whitelisted_token(&other_token.address);
    assert_eq!(client.get_whitelisted_tokens().len(), 2);

    client.remove_whitelisted_token(&token.address);
    assert!(!client.is_token_whitelisted(&token.address));
    assert!(client.is_token_whitelisted(&other_token.address));
    assert_eq!(client.get_whitelisted_tokens().len(), 1);
}

#[test]
#[should_panic(expected = "HostError")]
fn test_create_match_rejects_non_whitelisted_token() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);
    // Note: token is never whitelisted.

    let game_code = String::from_str(&env, "GAME_NOT_WL");
    client.create_match(&game_code, &player1, &token.address, &100);
}

#[test]
fn test_create_match_succeeds_after_whitelisting() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    let game_code = String::from_str(&env, "GAME_WL_OK");
    approve(&env, &token, &player1, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);

    let match_data = client.get_match(&game_code);
    assert_eq!(match_data.status, MatchStatus::Pending);
}

#[test]
#[should_panic(expected = "HostError")]
fn test_create_match_rejects_after_delisting() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);
    client.remove_whitelisted_token(&token.address);

    let game_code = String::from_str(&env, "GAME_DELISTED");
    approve(&env, &token, &player1, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);
}

// ---------------------------------------------------------------------------
// Issue #39 â€” Match Forfeit Resolution Trigger for Disconnects
// ---------------------------------------------------------------------------

#[test]
fn test_forfeit_match_pays_non_forfeiting_player() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500); // 5% fee
    client.add_whitelisted_token(&token.address);

    let game_code = String::from_str(&env, "GAME_FORFEIT");
    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);

    // Player 1 disconnects and never reconnects; coordinator forfeits them.
    client.forfeit_match(&game_code, &player1);

    let match_data = client.get_match(&game_code);
    assert_eq!(match_data.status, MatchStatus::Resolved);
    assert_eq!(match_data.winner, Some(player2.clone()));

    // Total staked = 200, 5% fee = 10, player2 gets 190.
    assert_eq!(token.balance(&player2), 1090);
    assert_eq!(token.balance(&coordinator), 10);
    assert_eq!(token.balance(&contract_id), 0);
}

#[test]
fn test_forfeit_match_other_color() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    let game_code = String::from_str(&env, "GAME_FORFEIT_2");
    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);

    // Player 2 disconnects this time.
    client.forfeit_match(&game_code, &player2);

    let match_data = client.get_match(&game_code);
    assert_eq!(match_data.winner, Some(player1.clone()));
    assert_eq!(token.balance(&player1), 1090);
}

#[test]
#[should_panic(expected = "HostError")]
fn test_forfeit_match_rejects_non_participant() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let outsider = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    let game_code = String::from_str(&env, "GAME_FORFEIT_BAD");
    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);

    client.forfeit_match(&game_code, &outsider);
}

#[test]
#[should_panic(expected = "HostError")]
fn test_forfeit_match_rejects_pending_match() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    let game_code = String::from_str(&env, "GAME_FORFEIT_PENDING");
    approve(&env, &token, &player1, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);
    // Player 2 never joined â€” match is still Pending, not Active.

    client.forfeit_match(&game_code, &player1);
}

#[test]
fn test_forfeit_match_settles_side_pool() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let spectator = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);
    token_admin_client.mint(&spectator, &500);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    let game_code = String::from_str(&env, "GAME_FORFEIT_BET");
    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    approve(&env, &token, &spectator, &contract_id, 500);
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);

    // Spectator bets on player2 (the eventual winner-by-forfeit).
    client.place_side_bet(&game_code, &spectator, &player2, &100);

    client.forfeit_match(&game_code, &player1);

    // Sole bettor on the winning side gets their stake back (no other side stakes).
    assert_eq!(token.balance(&spectator), 500);
}

// ---------------------------------------------------------------------------
// Issue #24 â€” Typed Soroban Contract Events on Escrow State Transitions
// ---------------------------------------------------------------------------

#[test]
fn test_events_emitted_on_lifecycle_transitions() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    let game_code = String::from_str(&env, "GAME_EVENTS");
    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);

    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);
    let events_after_create = env.events().all();
    assert!(events_after_create
        .iter()
        .any(|(id, _, _)| id == contract_id));

    client.join_match(&game_code, &player2);
    let events_after_join = env.events().all();
    assert!(events_after_join.iter().any(|(id, _, _)| id == contract_id));

    client.resolve_match(&game_code, &Some(player1.clone()));
    let events_after_resolve = env.events().all();
    assert!(events_after_resolve
        .iter()
        .any(|(id, _, _)| id == contract_id));
}

#[test]
fn test_event_emitted_on_forfeit() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    let game_code = String::from_str(&env, "GAME_EVENT_FORFEIT");
    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);

    client.forfeit_match(&game_code, &player1);
    let events_after = env.events().all();
    assert!(events_after.iter().any(|(id, _, _)| id == contract_id));
}

#[test]
fn test_event_emitted_on_refund() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    let game_code = String::from_str(&env, "GAME_EVENT_REFUND");
    approve(&env, &token, &player1, &contract_id, 1000);

    env.ledger().with_mut(|li| {
        li.timestamp = 1000;
    });
    approve(&env, &token, &player1, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);

    env.ledger().with_mut(|li| {
        li.timestamp = 4601;
    });

    client.refund_after_timeout(&game_code);
    let events_after = env.events().all();
    assert!(events_after.iter().any(|(id, _, _)| id == contract_id));
}

#[test]
fn test_gc_stale_matches() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);

    env.ledger().with_mut(|li| {
        li.timestamp = 1_000_000;
    });

    let game_code = String::from_str(&env, "GC_MATCH_1");
    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);
    client.resolve_match(&game_code, &Some(player1.clone()));

    // At 10 days later (<30 days), match is not stale yet.
    env.ledger().with_mut(|li| {
        li.timestamp = 1_000_000 + (10 * 86400);
    });

    let game_codes = vec![&env, game_code.clone()];
    let cleaned = client.gc_stale_matches(&game_codes);
    assert_eq!(cleaned, 0);

    // At 31 days later (>=30 days), match becomes stale and is cleaned up.
    env.ledger().with_mut(|li| {
        li.timestamp = 1_000_000 + (31 * 86400);
    });

    let cleaned = client.gc_stale_matches(&game_codes);
    assert_eq!(cleaned, 1);

    // Match should now be removed from persistent storage.
    let result = client.try_get_match(&game_code);
    assert!(result.is_err());
}

#[test]
fn test_gc_stale_single_match() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);

    env.ledger().with_mut(|li| {
        li.timestamp = 2_000_000;
    });

    let game_code = String::from_str(&env, "GC_SINGLE_1");
    approve(&env, &token, &player1, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);
    client.request_cancellation(&game_code, &player1);

    // Rejects GC while under 30 days old.
    assert!(!client.gc_stale_match(&game_code));

    // After 30 days, single match GC succeeds.
    env.ledger().with_mut(|li| {
        li.timestamp = 2_000_000 + (30 * 86400);
    });

    assert!(client.gc_stale_match(&game_code));
    assert!(client.try_get_match(&game_code).is_err());
}

#[test]
fn test_native_xlm_payment_wrapping() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (native_token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);

    // Set native XLM token address
    client.set_native_xlm_address(&native_token.address);
    assert_eq!(
        client.get_native_xlm_address(),
        Some(native_token.address.clone())
    );

    let game_code = String::from_str(&env, "NATIVE_XLM_GAME");
    approve(&env, &native_token, &player1, &contract_id, 1000);
    approve(&env, &native_token, &player2, &contract_id, 1000);

    client.create_native_match(&game_code, &player1, &100);
    client.join_native_match(&game_code, &player2);

    let match_data = client.get_match(&game_code);
    assert_eq!(match_data.status, MatchStatus::Active);
    assert_eq!(match_data.token, native_token.address);
    assert_eq!(match_data.total_staked, 200);
}

// ===========================================================================
// Additional tests: wager limits, timeouts, Elo, treasury vault, refunds, and
// the new Coordinator Key Rotation (multi-sig), Reentrancy Guard, Balance
// Invariant, and Upgradeability features.
// ===========================================================================

use soroban_sdk::BytesN;

#[test]
fn test_wager_limits_config() {
    let env = Env::default();
    env.mock_all_auths();
    let coordinator = Address::generate(&env);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);

    // Defaults
    let limits = client.get_wager_limits();
    assert_eq!(limits.min_wager, 1);
    assert_eq!(limits.max_wager, i128::MAX);

    // Set global limits
    client.set_wager_limits(&100, &5000);
    let limits = client.get_wager_limits();
    assert_eq!(limits.min_wager, 100);
    assert_eq!(limits.max_wager, 5000);
    assert_eq!(client.get_min_wager(), 100);
    assert_eq!(client.get_max_wager(), 5000);

    // Individually
    client.set_min_wager(&200);
    assert_eq!(client.get_min_wager(), 200);
    assert_eq!(client.get_max_wager(), 5000);
    client.set_max_wager(&8000);
    assert_eq!(client.get_max_wager(), 8000);

    // Invalid (min > max) panics
    assert!(client.try_set_wager_limits(&9000, &1000).is_err());
    // Non-positive min panics
    assert!(client.try_set_wager_limits(&0, &1000).is_err());
}

#[test]
fn test_token_wager_limits_config() {
    let env = Env::default();
    env.mock_all_auths();
    let coordinator = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token, _) = create_token_contract(&env, &token_admin);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);

    client.set_token_wager_limits(&token.address, &10, &100);
    let limits = client.get_token_wager_limits(&token.address);
    assert_eq!(limits.min_wager, 10);
    assert_eq!(limits.max_wager, 100);
    assert_eq!(client.get_token_min_wager(&token.address), 10);

    // Remove falls back to global
    client.remove_token_wager_limits(&token.address);
    let limits = client.get_token_wager_limits(&token.address);
    assert_eq!(limits.min_wager, 1);
}

#[test]
fn test_match_timeout_config() {
    let env = Env::default();
    env.mock_all_auths();
    let coordinator = Address::generate(&env);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);

    assert_eq!(client.get_match_timeout(), 3600);
    client.set_match_timeout(&1800);
    assert_eq!(client.get_match_timeout(), 1800);
    // Zero rejected
    assert!(client.try_set_match_timeout(&0).is_err());
}

#[test]
fn test_elo_default_and_update() {
    let env = Env::default();
    env.mock_all_auths();
    let coordinator = Address::generate(&env);
    let player = Address::generate(&env);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);

    assert_eq!(client.get_player_elo(&player), 1200);
    client.update_player_elo(&player, &1600);
    assert_eq!(client.get_player_elo(&player), 1600);
}

#[test]
fn test_treasury_vault_config_and_fee_routing() {
    let env = Env::default();
    env.mock_all_auths();
    let coordinator = Address::generate(&env);
    let vault = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&vault, &10_000);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);

    assert_eq!(client.get_treasury_vault(), None);
    client.set_treasury_vault(&vault);
    assert_eq!(client.get_treasury_vault(), Some(vault.clone()));

    let p1 = Address::generate(&env);
    let p2 = Address::generate(&env);
    token_admin_client.mint(&p1, &1000);
    token_admin_client.mint(&p2, &1000);
    client.add_whitelisted_token(&token.address);

    let gc = String::from_str(&env, "VAULT_GAME");
    approve(&env, &token, &p1, &contract_id, 1000);
    approve(&env, &token, &p2, &contract_id, 1000);
    client.create_match(&gc, &p1, &token.address, &200);
    client.join_match(&gc, &p2);

    let bal_before = token.balance(&vault);
    client.resolve_match(&gc, &Some(p2.clone()));
    // fee = total_staked(400) * 500bps / 10000 = 20
    assert_eq!(token.balance(&vault), bal_before + 20);
}

#[test]
fn test_claim_refund_flow() {
    let env = Env::default();
    env.mock_all_auths();
    let coordinator = Address::generate(&env);
    let p1 = Address::generate(&env);
    let p2 = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&p1, &1000);
    token_admin_client.mint(&p2, &1000);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    let gc = String::from_str(&env, "REFUND_GAME");
    approve(&env, &token, &p1, &contract_id, 1000);
    approve(&env, &token, &p2, &contract_id, 1000);
    client.create_match(&gc, &p1, &token.address, &100);
    client.join_match(&gc, &p2);

    // Not expired yet -> claim fails
    assert!(client.try_claim_refund(&gc, &p1).is_err());

    // Advance past timeout
    env.ledger().with_mut(|li| {
        li.timestamp = 10_000;
    });
    client.claim_refund(&gc, &p1);
    let m = client.get_match(&gc);
    assert_eq!(m.status, MatchStatus::Refunded);
    assert_eq!(token.balance(&p1), 1000);
}

#[test]
fn test_balance_invariant_escrowed_tracking() {
    let env = Env::default();
    env.mock_all_auths();
    let coordinator = Address::generate(&env);
    let p1 = Address::generate(&env);
    let p2 = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&p1, &1000);
    token_admin_client.mint(&p2, &1000);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    let gc = String::from_str(&env, "INV_GAME");
    approve(&env, &token, &p1, &contract_id, 1000);
    approve(&env, &token, &p2, &contract_id, 1000);
    client.create_match(&gc, &p1, &token.address, &100);
    client.join_match(&gc, &p2);

    // Escrowed == 200 (both wagers)
    assert_eq!(client.get_escrowed_balance(&token.address), 200);
    // Actual contract balance covers escrowed obligations
    assert!(client.get_treasury(&token.address) >= 200);

    // Side bet increases escrowed balance
    let spectator = Address::generate(&env);
    token_admin_client.mint(&spectator, &1000);
    approve(&env, &token, &spectator, &contract_id, 1000);
    client.place_side_bet(&gc, &spectator, &p1, &50);
    assert_eq!(client.get_escrowed_balance(&token.address), 250);

    // Resolution releases all escrowed funds
    client.resolve_match(&gc, &Some(p2.clone()));
    assert_eq!(client.get_escrowed_balance(&token.address), 0);
}

#[test]
fn test_coordinator_rotation_multisig() {
    let env = Env::default();
    env.mock_all_auths();
    let coordinator = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let new_coord = Address::generate(&env);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);

    // Initial signers = [coordinator]
    assert_eq!(client.get_admin_signers(), vec![&env, coordinator.clone()]);

    // Add second signer
    client.add_admin_signer(&signer2);
    assert_eq!(
        client.get_admin_signers(),
        vec![&env, coordinator.clone(), signer2.clone()]
    );

    // Single approval does not rotate yet
    client.propose_coordinator_rotation(&coordinator, &new_coord);
    assert_eq!(client.get_coordinator(), coordinator);
    assert_eq!(
        client.get_pending_rotation().unwrap().proposed_coordinator,
        new_coord
    );

    // Second distinct signer approves -> rotation executes
    client.approve_coordinator_rotation(&signer2, &new_coord);
    assert_eq!(client.get_coordinator(), new_coord);
    assert!(client.get_pending_rotation().is_none());
}

#[test]
fn test_coordinator_rotation_requires_signer() {
    let env = Env::default();
    env.mock_all_auths();
    let coordinator = Address::generate(&env);
    let outsider = Address::generate(&env);
    let new_coord = Address::generate(&env);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);

    // outsider is not an authorized signer -> proposal rejected
    assert!(client
        .try_propose_coordinator_rotation(&outsider, &new_coord)
        .is_err());
}

#[test]
fn test_coordinator_rotation_rejects_duplicate_and_mismatch() {
    let env = Env::default();
    env.mock_all_auths();
    let coordinator = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let new_coord = Address::generate(&env);
    let other = Address::generate(&env);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);
    client.add_admin_signer(&signer2);

    client.propose_coordinator_rotation(&coordinator, &new_coord);

    // Same signer approving again is rejected
    assert!(client
        .try_approve_coordinator_rotation(&coordinator, &new_coord)
        .is_err());

    // A different proposed address while a proposal is pending is rejected
    assert!(client
        .try_propose_coordinator_rotation(&signer2, &other)
        .is_err());
}

#[test]
fn test_reentrancy_guard_allows_normal_flow() {
    let env = Env::default();
    env.mock_all_auths();
    let coordinator = Address::generate(&env);
    let p1 = Address::generate(&env);
    let p2 = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&p1, &1000);
    token_admin_client.mint(&p2, &1000);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    let gc = String::from_str(&env, "REENT_GAME");
    approve(&env, &token, &p1, &contract_id, 1000);
    approve(&env, &token, &p2, &contract_id, 1000);
    client.create_match(&gc, &p1, &token.address, &100);
    client.join_match(&gc, &p2);

    // Guarded resolve executes and releases the lock
    client.resolve_match(&gc, &Some(p2.clone()));

    // A second guarded path on a fresh match works after the previous lock released
    let gc2 = String::from_str(&env, "REENT_GAME2");
    approve(&env, &token, &p1, &contract_id, 1000);
    client.create_match(&gc2, &p1, &token.address, &100);
    client.cancel_pending_match(&gc2, &p1);
}

#[test]
fn test_upgrade_requires_coordinator() {
    let env = Env::default();
    let coordinator = Address::generate(&env);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    // Authorize the coordinator so init succeeds.
    env.mock_all_auths();
    client.init(&coordinator, &500);

    // Drop blanket auth: upgrade must enforce coordinator authorization and
    // therefore fail here (before any WASM deployment is even attempted).
    env.set_auths(&[]);
    let hash = BytesN::from_array(&env, &[0u8; 32]);
    assert!(client.try_upgrade(&hash).is_err());
}

// ---------------------------------------------------------------------------
// Issue #22 â€“ Contract Pause / Unpause (circuit breaker) tests
// ---------------------------------------------------------------------------

#[test]
fn test_is_paused_defaults_to_false() {
    let env = Env::default();
    env.mock_all_auths();
    let coordinator = Address::generate(&env);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);

    assert!(!client.is_paused());
}

#[test]
fn test_pause_sets_paused_flag() {
    let env = Env::default();
    env.mock_all_auths();
    let coordinator = Address::generate(&env);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);

    assert!(!client.is_paused());
    client.pause();
    assert!(client.is_paused());
}

#[test]
fn test_unpause_clears_paused_flag() {
    let env = Env::default();
    env.mock_all_auths();
    let coordinator = Address::generate(&env);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);

    client.pause();
    assert!(client.is_paused());
    client.unpause();
    assert!(!client.is_paused());
}

#[test]
fn test_pause_blocks_create_match() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &10_000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    approve(&env, &token, &player1, &contract_id, 10_000);

    // Pause the contract
    client.pause();

    let game_code = String::from_str(&env, "GAME_PAUSED");
    let result = client.try_create_match(&game_code, &player1, &token.address, &100);
    assert!(result.is_err());
}

#[test]
fn test_pause_blocks_join_match() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &10_000);
    token_admin_client.mint(&player2, &10_000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    approve(&env, &token, &player1, &contract_id, 10_000);
    approve(&env, &token, &player2, &contract_id, 10_000);

    let game_code = String::from_str(&env, "GAME_JOIN_PAUSED");
    // Player 1 creates while unpaused
    client.create_match(&game_code, &player1, &token.address, &100);

    // Pause before player 2 joins
    client.pause();

    let result = client.try_join_match(&game_code, &player2);
    assert!(result.is_err());
}

#[test]
fn test_pause_blocks_create_tournament() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, _) = create_token_contract(&env, &token_admin);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    client.pause();

    let tournament_id = String::from_str(&env, "TOURN_PAUSED");
    let result = client.try_create_tournament(&tournament_id, &100, &8, &2, &0, &token.address);
    assert!(result.is_err());
}

#[test]
fn test_pause_blocks_join_tournament() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &10_000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    let tournament_id = String::from_str(&env, "TOURN_JOIN_PAUSED");
    // Create tournament while unpaused
    client.create_tournament(&tournament_id, &100, &8, &2, &0, &token.address);

    // Pause before anyone joins
    client.pause();

    approve(&env, &token, &player1, &contract_id, 10_000);
    let result = client.try_join_tournament(&tournament_id, &player1);
    assert!(result.is_err());
}

#[test]
fn test_unpause_allows_create_match() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &10_000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);
    approve(&env, &token, &player1, &contract_id, 10_000);

    // Pause then unpause
    client.pause();
    assert!(client.is_paused());
    client.unpause();
    assert!(!client.is_paused());

    // create_match should succeed after unpausing
    let game_code = String::from_str(&env, "GAME_AFTER_UNPAUSE");
    client.create_match(&game_code, &player1, &token.address, &100);
    let m = client.get_match(&game_code);
    assert_eq!(m.status, MatchStatus::Pending);
}

#[test]
fn test_refund_allowed_while_paused() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &10_000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    approve(&env, &token, &player1, &contract_id, 10_000);

    env.ledger().with_mut(|li| li.timestamp = 1000);
    let game_code = String::from_str(&env, "GAME_REFUND_PAUSED");
    client.create_match(&game_code, &player1, &token.address, &100);

    // Pause the contract after match creation
    client.pause();

    // Fast-forward past the timeout
    env.ledger()
        .with_mut(|li| li.timestamp = 1000 + MATCH_EXPIRATION_SECS + 1);

    // refund_after_timeout should still work while paused
    client.refund_after_timeout(&game_code);

    let m = client.get_match(&game_code);
    assert_eq!(m.status, MatchStatus::Refunded);
    // Player 1 gets their wager back
    assert_eq!(token.balance(&player1), 10_000);
}

#[test]
fn test_pause_emits_paused_event() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);

    let events_before = env.events().all().len();
    client.pause();
    let events_after = env.events().all();
    assert!(events_after.len() > events_before);
}

#[test]
fn test_unpause_emits_unpaused_event() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);

    client.pause();
    client.unpause();
    let events_after = env.events().all();
    assert!(!events_after.is_empty());
}

#[test]
fn test_pause_requires_coordinator_auth() {
    let env = Env::default();
    // Do NOT mock all auths â€” only mock specific ones
    let coordinator = Address::generate(&env);
    let non_coordinator = Address::generate(&env);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    // init requires coordinator auth
    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &coordinator,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &contract_id,
            fn_name: "init",
            args: (&coordinator, 500u32).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.init(&coordinator, &500);

    // Calling pause as non_coordinator should fail
    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &non_coordinator,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &contract_id,
            fn_name: "pause",
            args: ().into_val(&env),
            sub_invokes: &[],
        },
    }]);
    // pause internally calls get_coordinator().require_auth() which will fail
    // because the actual coordinator is different from non_coordinator
    let result = client.try_pause();
    assert!(result.is_err());
}

#[test]
fn test_unpause_requires_coordinator_auth() {
    let env = Env::default();
    let coordinator = Address::generate(&env);
    let non_coordinator = Address::generate(&env);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &coordinator,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &contract_id,
            fn_name: "init",
            args: (&coordinator, 500u32).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.init(&coordinator, &500);

    // Pause with valid coordinator
    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &coordinator,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &contract_id,
            fn_name: "pause",
            args: ().into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.pause();

    // Attempt unpause as non_coordinator
    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &non_coordinator,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &contract_id,
            fn_name: "unpause",
            args: ().into_val(&env),
            sub_invokes: &[],
        },
    }]);
    let result = client.try_unpause();
    assert!(result.is_err());
}

#[test]
fn test_set_fee_bps_rejects_values_above_100_percent() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);

    let result = client.try_set_fee_bps(&10_001);

    assert!(result.is_err());
    assert_eq!(client.get_fee_bps(), 500);
}

#[test]
fn test_set_fee_bps_requires_coordinator_auth() {
    let env = Env::default();
    let coordinator = Address::generate(&env);
    let non_coordinator = Address::generate(&env);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &coordinator,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &contract_id,
            fn_name: "init",
            args: (&coordinator, 500u32).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.init(&coordinator, &500);

    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &non_coordinator,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &contract_id,
            fn_name: "set_fee_bps",
            args: (1000u32,).into_val(&env),
            sub_invokes: &[],
        },
    }]);

    let result = client.try_set_fee_bps(&1000);

    assert!(result.is_err());
    assert_eq!(client.get_fee_bps(), 500);
}

#[test]
fn test_contract_storage_ttl_auto_extension() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    let game_code = String::from_str(&env, "GAME_TTL_1");
    approve(&env, &token, &player1, &contract_id, 100);
    client.create_match(&game_code, &player1, &token.address, &100);

    // Auto-extend TTL
    client.extend_match_ttl(&game_code);

    let match_data = client.get_match(&game_code);
    assert_eq!(match_data.status, MatchStatus::Pending);
}

#[test]
#[should_panic(expected = "Error(Contract, #22)")]
fn test_player_allowance_check_prior_to_create_match() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    let game_code = String::from_str(&env, "GAME_ALLOWANCE_1");
    // Only approve 50 when wager is 100
    approve(&env, &token, &player1, &contract_id, 50);

    // Should fail with InsufficientAllowance (#22)
    client.create_match(&game_code, &player1, &token.address, &100);
}

#[test]
#[should_panic(expected = "Error(Contract, #22)")]
fn test_player_allowance_check_prior_to_join_match() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    let game_code = String::from_str(&env, "GAME_ALLOWANCE_2");
    approve(&env, &token, &player1, &contract_id, 100);
    client.create_match(&game_code, &player1, &token.address, &100);

    // Player 2 only approves 50 when wager is 100
    approve(&env, &token, &player2, &contract_id, 50);
    client.join_match(&game_code, &player2);
}

#[test]
fn test_multi_match_batch_resolution_for_tournament_escrows() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let player3 = Address::generate(&env);
    let player4 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);
    token_admin_client.mint(&player3, &1000);
    token_admin_client.mint(&player4, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    // Match 1
    let game1 = String::from_str(&env, "TOURN_M1");
    approve(&env, &token, &player1, &contract_id, 100);
    approve(&env, &token, &player2, &contract_id, 100);
    client.create_match(&game1, &player1, &token.address, &100);
    client.join_match(&game1, &player2);

    // Match 2
    let game2 = String::from_str(&env, "TOURN_M2");
    approve(&env, &token, &player3, &contract_id, 100);
    approve(&env, &token, &player4, &contract_id, 100);
    client.create_match(&game2, &player3, &token.address, &100);
    client.join_match(&game2, &player4);

    let mut resolutions = Vec::new(&env);
    resolutions.push_back(MatchResolution {
        match_id: game1.clone(),
        winner: Some(player1.clone()),
        moves_hash: String::from_str(&env, "hash1"),
    });
    resolutions.push_back(MatchResolution {
        match_id: game2.clone(),
        winner: None, // Draw
        moves_hash: String::from_str(&env, "hash2"),
    });

    client.batch_resolve_tournament_matches(&resolutions);

    let m1 = client.get_match(&game1);
    assert_eq!(m1.status, MatchStatus::Resolved);
    assert_eq!(m1.winner, Some(player1));

    let m2 = client.get_match(&game2);
    assert_eq!(m2.status, MatchStatus::Resolved);
    assert_eq!(m2.winner, None);
}

#[test]
#[should_panic(expected = "Error(Contract, #26)")]
fn test_batch_resolve_matches_rejects_empty() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);

    let resolutions = Vec::new(&env);
    client.batch_resolve_matches(&resolutions);
}

#[test]
#[should_panic(expected = "Error(Contract, #26)")]
fn test_batch_resolve_matches_rejects_exceeding_max() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);

    let mut resolutions = Vec::new(&env);
    for _ in 0..11 {
        resolutions.push_back(MatchResolution {
            match_id: String::from_str(&env, "G"),
            winner: None,
            moves_hash: String::from_str(&env, "hash"),
        });
    }
    client.batch_resolve_tournament_matches(&resolutions);
}

#[test]
fn test_resolve_match_with_signature() {
    let env = Env::default();
    env.mock_all_auths();

    use ed25519_dalek::{Signer, SigningKey};
    use soroban_sdk::xdr::ToXdr;

    let signing_key = SigningKey::from_bytes(&[1u8; 32]);
    let pubkey_bytes = signing_key.verifying_key().to_bytes();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);
    client.set_coordinator_pubkey(&BytesN::from_array(&env, &pubkey_bytes));

    let game_code = String::from_str(&env, "GAME_SIG");
    approve(&env, &token, &player1, &contract_id, 100);
    approve(&env, &token, &player2, &contract_id, 100);
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);

    let payload = MatchResolutionPayload {
        match_id: game_code.clone(),
        winner: Some(player1.clone()),
        moves_hash: String::from_str(&env, "some_hash"),
        nonce: 12345,
    };

    let payload_bytes = payload.clone().to_xdr(&env);
    let mut payload_slice = alloc::vec![0u8; payload_bytes.len() as usize];
    payload_bytes.copy_into_slice(&mut payload_slice);
    let signature = signing_key.sign(&payload_slice);
    let sig_bytes = signature.to_bytes();

    client.resolve_match_with_signature(&payload, &BytesN::from_array(&env, &sig_bytes));

    let m = client.get_match(&game_code);
    assert_eq!(m.status, MatchStatus::Resolved);
    assert_eq!(token.balance(&player1), 1090);
    assert_eq!(token.balance(&player2), 900);
}

#[test]
#[should_panic(expected = "HostError")]
fn test_resolve_match_with_invalid_signature() {
    let env = Env::default();
    env.mock_all_auths();

    use ed25519_dalek::SigningKey;

    let signing_key = SigningKey::from_bytes(&[1u8; 32]);
    let pubkey_bytes = signing_key.verifying_key().to_bytes();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);
    client.set_coordinator_pubkey(&BytesN::from_array(&env, &pubkey_bytes));

    let game_code = String::from_str(&env, "GAME_SIG_BAD");
    approve(&env, &token, &player1, &contract_id, 100);
    approve(&env, &token, &player2, &contract_id, 100);
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);

    let payload = MatchResolutionPayload {
        match_id: game_code.clone(),
        winner: Some(player1.clone()),
        moves_hash: String::from_str(&env, "some_hash"),
        nonce: 12345,
    };

    let bad_sig_bytes = [0u8; 64];
    client.resolve_match_with_signature(&payload, &BytesN::from_array(&env, &bad_sig_bytes));
}

#[test]
#[should_panic(expected = "Error(Contract, #43)")]
fn test_resolve_match_with_used_nonce() {
    let env = Env::default();
    env.mock_all_auths();

    use ed25519_dalek::{Signer, SigningKey};
    use soroban_sdk::xdr::ToXdr;

    let signing_key = SigningKey::from_bytes(&[1u8; 32]);
    let pubkey_bytes = signing_key.verifying_key().to_bytes();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);
    client.set_coordinator_pubkey(&BytesN::from_array(&env, &pubkey_bytes));

    let game_code = String::from_str(&env, "GAME_SIG_NONCE");
    approve(&env, &token, &player1, &contract_id, 100);
    approve(&env, &token, &player2, &contract_id, 100);
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);

    let payload = MatchResolutionPayload {
        match_id: game_code.clone(),
        winner: Some(player1.clone()),
        moves_hash: String::from_str(&env, "some_hash"),
        nonce: 12345,
    };

    let payload_bytes = payload.clone().to_xdr(&env);
    let mut payload_slice = alloc::vec![0u8; payload_bytes.len() as usize];
    payload_bytes.copy_into_slice(&mut payload_slice);
    let signature = signing_key.sign(&payload_slice);
    let sig_bytes = signature.to_bytes();

    client.resolve_match_with_signature(&payload, &BytesN::from_array(&env, &sig_bytes));

    // Should panic on second invocation
    client.resolve_match_with_signature(&payload, &BytesN::from_array(&env, &sig_bytes));
}

#[test]
fn test_batch_resolve_five_matches() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    let mut resolutions = Vec::new(&env);
    for i in 0..5 {
        let p1 = Address::generate(&env);
        let p2 = Address::generate(&env);
        token_admin_client.mint(&p1, &1000);
        token_admin_client.mint(&p2, &1000);

        let game_code = String::from_str(&env, &alloc::format!("GAME{}", i));
        approve(&env, &token, &p1, &contract_id, 100);
        approve(&env, &token, &p2, &contract_id, 100);
        client.create_match(&game_code, &p1, &token.address, &100);
        client.join_match(&game_code, &p2);

        resolutions.push_back(MatchResolution {
            match_id: game_code.clone(),
            winner: Some(p1.clone()),
            moves_hash: String::from_str(&env, "hash"),
        });
    }

    client.batch_resolve_matches(&resolutions);

    for i in 0..5 {
        let game_code = String::from_str(&env, &alloc::format!("GAME{}", i));
        let m = client.get_match(&game_code);
        assert_eq!(m.status, MatchStatus::Resolved);
    }
}

#[test]
fn test_player_rating_commitment() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player = Address::generate(&env);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);

    // Initial query should return None
    assert_eq!(client.get_player_rating(&player), None);

    // Commit player rating
    client.commit_player_rating(&player, &1650, &42);

    // Query record and verify contents
    let record = client
        .get_player_rating(&player)
        .expect("record should exist");
    assert_eq!(record.rating, 1650);
    assert_eq!(record.games_played, 42);
    assert_eq!(record.updated_at, env.ledger().timestamp());
    assert_eq!(record.last_updated(), env.ledger().timestamp());

    // Update player rating after more games
    env.ledger().set_timestamp(env.ledger().timestamp() + 3600);
    client.commit_player_rating(&player, &1720, &55);

    let updated = client
        .get_player_rating(&player)
        .expect("updated record should exist");
    assert_eq!(updated.rating, 1720);
    assert_eq!(updated.games_played, 55);
    assert_eq!(updated.updated_at, env.ledger().timestamp());
}

#[test]
fn test_player_rating_unauthorized() {
    let env = Env::default();
    let coordinator = Address::generate(&env);
    let player = Address::generate(&env);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    env.mock_all_auths();
    client.init(&coordinator, &500);

    // Disallow mock auths
    env.set_auths(&[]);
    let res = client.try_commit_player_rating(&player, &1800, &20);
    assert!(
        res.is_err(),
        "Non-coordinator or unauthorized call must fail"
    );
}

#[test]
fn test_player_rating_commitment_with_signature() {
    let env = Env::default();
    env.mock_all_auths();

    use ed25519_dalek::{Signer, SigningKey};
    use soroban_sdk::xdr::ToXdr;

    let signing_key = SigningKey::from_bytes(&[2u8; 32]);
    let pubkey_bytes = signing_key.verifying_key().to_bytes();

    let coordinator = Address::generate(&env);
    let player = Address::generate(&env);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.set_coordinator_pubkey(&BytesN::from_array(&env, &pubkey_bytes));

    let payload = RatingCommitmentPayload {
        player: player.clone(),
        rating: 1950,
        games_played: 120,
    };
    let payload_bytes = payload.to_xdr(&env);
    let mut payload_slice = alloc::vec![0u8; payload_bytes.len() as usize];
    payload_bytes.copy_into_slice(&mut payload_slice);
    let signature = signing_key.sign(&payload_slice);
    let sig_bytes = signature.to_bytes();

    client.commit_player_rating_with_sig(
        &player,
        &1950,
        &120,
        &BytesN::from_array(&env, &sig_bytes),
    );

    let record = client
        .get_player_rating(&player)
        .expect("record should exist");
    assert_eq!(record.rating, 1950);
    assert_eq!(record.games_played, 120);
}

#[test]
#[should_panic(expected = "HostError")]
fn test_player_rating_commitment_with_invalid_signature() {
    let env = Env::default();
    env.mock_all_auths();

    use ed25519_dalek::SigningKey;

    let signing_key = SigningKey::from_bytes(&[3u8; 32]);
    let pubkey_bytes = signing_key.verifying_key().to_bytes();

    let coordinator = Address::generate(&env);
    let player = Address::generate(&env);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.set_coordinator_pubkey(&BytesN::from_array(&env, &pubkey_bytes));

    let bad_sig = [9u8; 64];
    client.commit_player_rating_with_sig(&player, &2100, &300, &BytesN::from_array(&env, &bad_sig));
}

#[test]
fn test_replay_protection() {
    let env = Env::default();
    env.mock_all_auths();

    let player = Address::generate(&env);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    // Initial nonce must be 0
    assert_eq!(client.get_account_nonce(&player), 0);
    assert_eq!(client.get_player_nonce(&player), 0);

    // 1. Valid first execution with nonce = 1 succeeds and increments nonce
    client.increment_player_nonce(&player, &1);
    assert_eq!(client.get_account_nonce(&player), 1);
    assert_eq!(client.get_player_nonce(&player), 1);

    // 2. Valid second execution with nonce = 2 succeeds and increments nonce
    client.increment_player_nonce(&player, &2);
    assert_eq!(client.get_account_nonce(&player), 2);
    assert_eq!(client.get_player_nonce(&player), 2);

    // 3. Test deposit authorization payload verification
    let payload = DepositAuthorizationPayload {
        player: player.clone(),
        game_code: String::from_str(&env, "GAME_DEP"),
        amount: 100,
        nonce: 3,
    };
    client.verify_deposit_authorization(&payload);
    assert_eq!(client.get_account_nonce(&player), 3);
}

#[test]
#[should_panic(expected = "Error(Contract, #44)")]
fn test_replay_protection_rejects_duplicate_nonce() {
    let env = Env::default();
    env.mock_all_auths();

    let player = Address::generate(&env);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    // Nonce 1 executes
    client.increment_player_nonce(&player, &1);
    assert_eq!(client.get_account_nonce(&player), 1);

    // Replay of Nonce 1 must panic with InvalidNonce (#44)
    client.increment_player_nonce(&player, &1);
}

#[test]
#[should_panic(expected = "Error(Contract, #44)")]
fn test_replay_protection_rejects_out_of_order_nonce() {
    let env = Env::default();
    env.mock_all_auths();

    let player = Address::generate(&env);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    // Skipping from 0 to 5 must fail with InvalidNonce (#44)
    client.increment_player_nonce(&player, &5);
}

// ---------------------------------------------------------------------------
// Tests for Issue #287: Custom Time-Lock Wager Match Escrows
// ---------------------------------------------------------------------------

#[test]
fn test_custom_match_duration_bullet_vs_classical() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &2000);
    token_admin_client.mint(&player2, &2000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    approve(&env, &token, &player1, &contract_id, 2000);
    approve(&env, &token, &player2, &contract_id, 2000);

    // Bullet match with 180s duration
    let bullet_game = String::from_str(&env, "BULLET_180");
    client.create_match_with_duration(&bullet_game, &player1, &token.address, &100, &180);
    client.join_match(&bullet_game, &player2);

    let bullet_data = client.get_match(&bullet_game);
    assert_eq!(bullet_data.max_duration_seconds, 180);
    assert_eq!(bullet_data.status, MatchStatus::Active);

    // Classical match with 3600s duration
    let classical_game = String::from_str(&env, "CLASSICAL_3600");
    client.create_match_with_duration(&classical_game, &player1, &token.address, &100, &3600);
    client.join_match(&classical_game, &player2);

    let classical_data = client.get_match(&classical_game);
    assert_eq!(classical_data.max_duration_seconds, 3600);
    assert_eq!(classical_data.status, MatchStatus::Active);

    // Advance ledger timestamp by 200 seconds (bullet expired, classical still active)
    let current_time = env.ledger().timestamp();
    env.ledger().set_timestamp(current_time + 200);

    // Bullet match can be claimed via abandoned refund
    client.claim_abandoned_refund(&bullet_game);
    let updated_bullet = client.get_match(&bullet_game);
    assert_eq!(updated_bullet.status, MatchStatus::Refunded);

    // Both players received their wagers back for the bullet match
    assert_eq!(token.balance(&player1), 1900); // 100 refunded from bullet, 100 still locked in classical
    assert_eq!(token.balance(&player2), 1900);

    // Advance time past classical timeout (total +3700s)
    env.ledger().set_timestamp(current_time + 3700);
    client.claim_abandoned_refund(&classical_game);
    let updated_classical = client.get_match(&classical_game);
    assert_eq!(updated_classical.status, MatchStatus::Refunded);

    // Both players are fully refunded
    assert_eq!(token.balance(&player1), 2000);
    assert_eq!(token.balance(&player2), 2000);
}

#[test]
#[should_panic(expected = "HostError")]
fn test_custom_match_duration_rejects_below_minimum() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);
    approve(&env, &token, &player1, &contract_id, 1000);

    let game = String::from_str(&env, "TOO_SHORT");
    // 60s is below MIN_MATCH_DURATION_SECS (120s)
    client.create_match_with_duration(&game, &player1, &token.address, &100, &60);
}

#[test]
#[should_panic(expected = "HostError")]
fn test_custom_match_duration_rejects_above_maximum() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);
    approve(&env, &token, &player1, &contract_id, 1000);

    let game = String::from_str(&env, "TOO_LONG");
    // 100_000s is above MAX_MATCH_DURATION_SECS (86400s)
    client.create_match_with_duration(&game, &player1, &token.address, &100, &100_000);
}

// ---------------------------------------------------------------------------
// Tests for Issue #288: Contract State Snapshot Export / Platform Metrics
// ---------------------------------------------------------------------------

#[test]
fn test_platform_metrics_tracking() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &5000);
    token_admin_client.mint(&player2, &5000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500); // 5% fee
    client.add_whitelisted_token(&token.address);

    approve(&env, &token, &player1, &contract_id, 5000);
    approve(&env, &token, &player2, &contract_id, 5000);

    // Initial metrics should be 0
    let initial_metrics = client.get_platform_metrics();
    assert_eq!(initial_metrics.total_matches_created, 0);
    assert_eq!(initial_metrics.active_matches_count, 0);
    assert_eq!(initial_metrics.total_volume_xlm, 0);
    assert_eq!(initial_metrics.total_rake_collected, 0);

    // Match 1: Player 1 creates
    let game1 = String::from_str(&env, "METRICS_GAME_1");
    client.create_match(&game1, &player1, &token.address, &200);

    let m1 = client.get_platform_metrics();
    assert_eq!(m1.total_matches_created, 1);
    assert_eq!(m1.active_matches_count, 1);
    assert_eq!(m1.total_volume_xlm, 200);

    // Player 2 joins Match 1
    client.join_match(&game1, &player2);
    let m2 = client.get_platform_metrics();
    assert_eq!(m2.total_matches_created, 1);
    assert_eq!(m2.active_matches_count, 1);
    assert_eq!(m2.total_volume_xlm, 400);

    // Match 1 resolved with Player 1 winning (400 pool, 5% fee = 20)
    client.resolve_match(&game1, &Some(player1.clone()));
    let m3 = client.get_platform_metrics();
    assert_eq!(m3.total_matches_created, 1);
    assert_eq!(m3.active_matches_count, 0);
    assert_eq!(m3.total_volume_xlm, 400);
    assert_eq!(m3.total_rake_collected, 20);

    // Match 2: Player 1 creates and cancels
    let game2 = String::from_str(&env, "METRICS_GAME_2");
    client.create_match(&game2, &player1, &token.address, &300);
    let m4 = client.get_platform_metrics();
    assert_eq!(m4.total_matches_created, 2);
    assert_eq!(m4.active_matches_count, 1);
    assert_eq!(m4.total_volume_xlm, 700);

    client.cancel_pending_match(&game2, &player1);
    let m5 = client.get_platform_metrics();
    assert_eq!(m5.total_matches_created, 2);
    assert_eq!(m5.active_matches_count, 0);
    assert_eq!(m5.total_volume_xlm, 700);
    assert_eq!(m5.total_rake_collected, 20);
}

// ---------------------------------------------------------------------------
// Tests for Issue #289: Native Stellar Fee Sponsorship & Account Creation
// ---------------------------------------------------------------------------

#[test]
fn test_sponsored_deposit_invocation() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let sponsor = Address::generate(&env);
    let unfunded_player1 = Address::generate(&env);
    let unfunded_player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    // Only sponsor has funds; unfunded players have 0 balance
    token_admin_client.mint(&sponsor, &5000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    approve(&env, &token, &sponsor, &contract_id, 5000);

    let game_code = String::from_str(&env, "SPONSORED_GAME");

    // Sponsor funds deposit to create match on behalf of unfunded Player 1
    client.record_sponsored_deposit(&game_code, &unfunded_player1, &sponsor, &150);

    let match_data = client.get_match(&game_code);
    assert_eq!(match_data.player1, unfunded_player1);
    assert_eq!(match_data.status, MatchStatus::Pending);
    assert_eq!(match_data.wager_amount, 150);
    assert_eq!(token.balance(&contract_id), 150);
    assert_eq!(client.get_player_sponsorship_total(&unfunded_player1), 150);

    // Sponsor funds deposit to join match on behalf of unfunded Player 2
    client.record_sponsored_deposit(&game_code, &unfunded_player2, &sponsor, &150);

    let funded_match = client.get_match(&game_code);
    assert_eq!(funded_match.player2, Some(unfunded_player2.clone()));
    assert_eq!(funded_match.status, MatchStatus::Active);
    assert_eq!(funded_match.total_staked, 300);
    assert_eq!(token.balance(&contract_id), 300);
    assert_eq!(client.get_player_sponsorship_total(&unfunded_player2), 150);
}

// ---------------------------------------------------------------------------
// Tests for Issue #290: Collaborative Multi-Party Match Cancellation Protocol
// ---------------------------------------------------------------------------

#[test]
fn test_collaborative_mutual_cancellation_protocol() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);

    let game_code = String::from_str(&env, "MUTUAL_CANC_1");
    client.create_match(&game_code, &player1, &token.address, &200);
    client.join_match(&game_code, &player2);

    assert_eq!(token.balance(&player1), 800);
    assert_eq!(token.balance(&player2), 800);
    assert_eq!(token.balance(&contract_id), 400);

    // Player 1 proposes mutual cancellation
    client.propose_mutual_cancellation(&game_code, &player1);
    let match_data = client.get_match(&game_code);
    assert_eq!(match_data.cancellation_proposed_by, Some(player1.clone()));

    // Player 2 confirms mutual cancellation
    client.confirm_mutual_cancellation(&game_code, &player2);

    let cancelled_match = client.get_match(&game_code);
    assert_eq!(cancelled_match.status, MatchStatus::Refunded);
    assert_eq!(cancelled_match.cancellation_proposed_by, None);

    // Both players received 100% of their deposits back
    assert_eq!(token.balance(&player1), 1000);
    assert_eq!(token.balance(&player2), 1000);
    assert_eq!(token.balance(&contract_id), 0);
}

#[test]
#[should_panic(expected = "HostError")]
fn test_mutual_cancellation_cannot_confirm_own_proposal() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);

    let game_code = String::from_str(&env, "OWN_PROPOSAL");
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);

    client.propose_mutual_cancellation(&game_code, &player1);
    // Player 1 cannot confirm their own proposal -> panics with CannotConfirmOwnProposal
    client.confirm_mutual_cancellation(&game_code, &player1);
}

#[test]
fn test_withdraw_cancellation_proposal() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);

    let game_code = String::from_str(&env, "WITHDRAW_PROP");
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);

    client.propose_mutual_cancellation(&game_code, &player1);
    assert_eq!(client.get_match(&game_code).cancellation_proposed_by, Some(player1.clone()));

    // Proposer withdraws proposal
    client.withdraw_cancellation_proposal(&game_code, &player1);
    assert_eq!(client.get_match(&game_code).cancellation_proposed_by, None);
}

#[test]
#[should_panic(expected = "HostError")]
fn test_mutual_cancellation_outsider_cannot_confirm() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let outsider = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);

    let game_code = String::from_str(&env, "OUTSIDER_TEST");
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);

    client.propose_mutual_cancellation(&game_code, &player1);
    // Outsider cannot confirm -> panics with UnauthorizedPlayer
    client.confirm_mutual_cancellation(&game_code, &outsider);
}

#![cfg(test)]

extern crate alloc;

use super::*;
use proptest::{
    prelude::*,
    test_runner::{Config as ProptestConfig, TestRunner},
};
use soroban_sdk::token::Client as TokenClient;
use soroban_sdk::token::StellarAssetClient as TokenAdminClient;
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    vec, Address, Env, String,
};

fn create_token_contract<'a>(e: &Env, admin: &Address) -> (TokenClient<'a>, TokenAdminClient<'a>) {
    let contract_id = e.register_stellar_asset_contract_v2(admin.clone());
    (
        TokenClient::new(e, &contract_id.address()),
        TokenAdminClient::new(e, &contract_id.address()),
    )
}

/// Grant a player a token allowance for the escrow contract (Issue #26).
fn approve(e: &Env, token: &TokenClient, owner: &Address, spender: &Address, amount: i128) {
    token.approve(owner, spender, &amount, &(e.ledger().sequence() + 1_000));
}

#[test]
fn test_create_and_join_match() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);

    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500); // 5% fee
    client.add_whitelisted_token(&token.address);

    let game_code = String::from_str(&env, "GAME123");

    // Player 1 creates match
    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);

    assert_eq!(token.balance(&player1), 900);
    assert_eq!(token.balance(&contract_id), 100);

    let match_data = client.get_match(&game_code);
    assert_eq!(match_data.status, MatchStatus::Pending);
    assert_eq!(match_data.wager_amount, 100);
    assert_eq!(match_data.nonce, 1); // Issue #34 Nonce test

    // Player 2 joins match
    client.join_match(&game_code, &player2);

    assert_eq!(token.balance(&player2), 900);
    assert_eq!(token.balance(&contract_id), 200);

    let match_data = client.get_match(&game_code);
    assert_eq!(match_data.status, MatchStatus::Active);
    assert_eq!(match_data.total_staked, 200);
}

#[test]
fn test_match_nonce_increments() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &10000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    assert_eq!(client.get_match_nonce(), 0);

    approve(&env, &token, &player1, &contract_id, 10000);

    let game_1 = String::from_str(&env, "GAME_NONCE_1");
    client.create_match(&game_1, &player1, &token.address, &100);
    assert_eq!(client.get_match_nonce(), 1);

    let game_2 = String::from_str(&env, "GAME_NONCE_2");
    client.create_match(&game_2, &player1, &token.address, &100);
    assert_eq!(client.get_match_nonce(), 2);
}

#[test]
fn test_resolve_match_winner() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500); // 5% fee
    client.add_whitelisted_token(&token.address);

    let game_code = String::from_str(&env, "GAME123");
    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);

    client.resolve_match(&game_code, &Some(player1.clone()));

    let match_data = client.get_match(&game_code);
    assert_eq!(match_data.status, MatchStatus::Resolved);
    assert_eq!(match_data.winner, Some(player1.clone()));

    assert_eq!(token.balance(&player1), 1090);
    assert_eq!(token.balance(&coordinator), 10);
    assert_eq!(token.balance(&contract_id), 0);
}

#[test]
fn test_governance_token_fee_discount() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    let (gov_token, gov_token_admin_client) = create_token_contract(&env, &token_admin);

    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);
    gov_token_admin_client.mint(&player1, &10000); // Holds 10,000 gov tokens -> 50% discount

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500); // 5% fee base (500 bps)
    client.add_whitelisted_token(&token.address);
    client.set_gov_token(&gov_token.address);

    assert_eq!(client.get_gov_token(), Some(gov_token.address.clone()));
    assert_eq!(client.get_effective_fee_bps(&player1), 250); // 50% discount -> 250 bps (2.5%)

    let game_code = String::from_str(&env, "GAME_DISCOUNT");
    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);

    // Resolve match: total staked = 200. Fee = 2.5% of 200 = 5. Winner gets 195.
    client.resolve_match(&game_code, &Some(player1.clone()));

    assert_eq!(token.balance(&player1), 1095);
    assert_eq!(token.balance(&coordinator), 5);
}

#[test]
fn test_spectator_side_pool_payout() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let spectator1 = Address::generate(&env);
    let spectator2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);
    token_admin_client.mint(&spectator1, &500);
    token_admin_client.mint(&spectator2, &500);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    let game_code = String::from_str(&env, "GAME_BET");
    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    approve(&env, &token, &spectator1, &contract_id, 500);
    approve(&env, &token, &spectator2, &contract_id, 500);
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);

    // Spectator 1 bets 100 on Player 1
    client.place_side_bet(&game_code, &spectator1, &player1, &100);
    // Spectator 2 bets 100 on Player 2
    client.place_side_bet(&game_code, &spectator2, &player2, &100);

    let side_pool = client.get_side_pool(&game_code);
    assert_eq!(side_pool.total_player1_side_staked, 100);
    assert_eq!(side_pool.total_player2_side_staked, 100);
    assert_eq!(side_pool.bets.len(), 2);

    // Resolve match with Player 1 winning
    // Total side pool = 200. Winning side staked = 100.
    // Spectator 1 gets (100 * 200) / 100 = 200.
    client.resolve_match(&game_code, &Some(player1.clone()));

    assert_eq!(token.balance(&spectator1), 600); // 400 + 200 = 600
    assert_eq!(token.balance(&spectator2), 400); // 500 - 100 = 400
}

#[test]
fn test_mutual_cancellation() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    let game_code = String::from_str(&env, "GAME_CANCEL");
    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);

    // Player 1 requests cancellation
    client.request_cancellation(&game_code, &player1);
    let (c1, c2) = client.get_cancellation_status(&game_code);
    assert!(c1);
    assert!(!c2);
    assert_eq!(client.get_match(&game_code).status, MatchStatus::Active);

    // Player 2 requests cancellation -> triggers full refund
    client.request_cancellation(&game_code, &player2);
    let match_data = client.get_match(&game_code);
    assert_eq!(match_data.status, MatchStatus::Refunded);

    assert_eq!(token.balance(&player1), 1000);
    assert_eq!(token.balance(&player2), 1000);
    assert_eq!(token.balance(&contract_id), 0);
}

#[test]
fn test_resolve_match_draw() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    let game_code = String::from_str(&env, "GAME123");
    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);

    client.resolve_match(&game_code, &None);

    let match_data = client.get_match(&game_code);
    assert_eq!(match_data.status, MatchStatus::Resolved);
    assert_eq!(match_data.winner, None);

    assert_eq!(token.balance(&player1), 1000);
    assert_eq!(token.balance(&player2), 1000);
    assert_eq!(token.balance(&contract_id), 0);
}

#[test]
fn test_refund_after_timeout() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    let game_code = String::from_str(&env, "GAME123");

    env.ledger().with_mut(|li| {
        li.timestamp = 1000;
    });

    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);

    env.ledger().with_mut(|li| {
        li.timestamp = 4601;
    });

    client.refund_after_timeout(&game_code);

    let match_data = client.get_match(&game_code);
    assert_eq!(match_data.status, MatchStatus::Refunded);

    assert_eq!(token.balance(&player1), 1000);
    assert_eq!(token.balance(&player2), 1000);
    assert_eq!(token.balance(&contract_id), 0);
}

#[test]
#[should_panic(expected = "HostError")]
fn test_refund_before_timeout_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    let game_code = String::from_str(&env, "GAME123");

    env.ledger().with_mut(|li| {
        li.timestamp = 1000;
    });

    approve(&env, &token, &player1, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);

    env.ledger().with_mut(|li| {
        li.timestamp = 2000;
    });

    client.refund_after_timeout(&game_code);
}

#[test]
fn test_get_coordinator_and_fee_bps() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, _token_admin_client) = create_token_contract(&env, &token_admin);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_supported_token(&token.address);

    assert_eq!(client.get_coordinator(), coordinator);
    assert_eq!(client.get_fee_bps(), 500);
}

#[test]
fn test_get_treasury() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    let game_code = String::from_str(&env, "GAME123");
    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);

    assert_eq!(client.get_treasury(&token.address), 200);
}

#[test]
#[should_panic(expected = "HostError")]
fn test_max_active_matches() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &10000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    let g0 = String::from_str(&env, "GAME0");
    approve(&env, &token, &player1, &contract_id, 10000);
    let g1 = String::from_str(&env, "GAME1");
    let g2 = String::from_str(&env, "GAME2");
    let g3 = String::from_str(&env, "GAME3");
    let g4 = String::from_str(&env, "GAME4");
    client.create_match(&g0, &player1, &token.address, &100);
    client.create_match(&g1, &player1, &token.address, &100);
    client.create_match(&g2, &player1, &token.address, &100);
    client.create_match(&g3, &player1, &token.address, &100);
    client.create_match(&g4, &player1, &token.address, &100);

    let game_6 = String::from_str(&env, "GAME6");
    client.create_match(&game_6, &player1, &token.address, &100);
}

#[test]
fn test_tournament_create_and_join() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_supported_token(&token.address);

    let tournament_id = String::from_str(&env, "TOURNAMENT1");

    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    client.create_tournament(&tournament_id, &100, &8, &2, &0, &token.address);

    client.join_tournament(&tournament_id, &player1);
    client.join_tournament(&tournament_id, &player2);

    let tournament = client.get_tournament(&tournament_id);
    assert_eq!(tournament.total_pool, 200);
    assert_eq!(tournament.players.len(), 2);
}

#[test]
fn test_tournament_complete() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.set_tournament_fee_bps(&500);
    client.add_supported_token(&token.address);

    let tournament_id = String::from_str(&env, "TOURNAMENT1");

    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    client.create_tournament(&tournament_id, &100, &8, &2, &0, &token.address);
    client.join_tournament(&tournament_id, &player1);
    client.join_tournament(&tournament_id, &player2);

    let winners = vec![&env, player1.clone(), player2.clone()];
    let payout_bps = vec![&env, 7000_u32, 3000_u32];
    client.complete_tournament(&tournament_id, &winners, &payout_bps);

    let tournament = client.get_tournament(&tournament_id);
    assert_eq!(tournament.status, TournamentStatus::Completed);
    // Total pool 200. Fee 500 bps (5%) = 10 tokens to coordinator. Net pool = 190.
    // 1st place: 190 * 7000 / 10000 = 133. Player 1: 1000 - 100 + 133 = 1033.
    // 2nd place: 190 - 133 = 57. Player 2: 1000 - 100 + 57 = 957.
    assert_eq!(token.balance(&player1), 1033);
    assert_eq!(token.balance(&player2), 957);
    assert_eq!(token.balance(&coordinator), 10);
}

#[test]
fn test_tournament_eight_player_payout_conserves_pool() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let treasury_vault = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let players = [
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
    ];

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    for player in &players {
        token_admin_client.mint(player, &100);
    }

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);
    client.set_treasury_vault(&treasury_vault);
    client.set_tournament_fee_bps(&500);
    client.add_supported_token(&token.address);

    for player in &players {
        approve(&env, &token, player, &contract_id, 10);
    }

    let tournament_id = String::from_str(&env, "TOURN_EIGHT_PLAYERS");
    client.create_tournament(&tournament_id, &10, &8, &2, &0, &token.address);
    for player in &players {
        client.join_tournament(&tournament_id, player);
    }

    let active = client.get_tournament(&tournament_id);
    assert_eq!(active.status, TournamentStatus::Active);
    assert_eq!(active.players.len(), 8);
    assert_eq!(active.total_pool, 80);
    assert_eq!(token.balance(&contract_id), 80);

    let winners = vec![&env, players[0].clone(), players[1].clone()];
    let payout_bps = vec![&env, 7000_u32, 3000_u32];
    client.complete_tournament(&tournament_id, &winners, &payout_bps);

    // 80 pool - 5% fee (4) = 76 prize pool; integer remainder goes to second place.
    assert_eq!(token.balance(&players[0]), 143);
    assert_eq!(token.balance(&players[1]), 113);
    for player in players.iter().skip(2) {
        assert_eq!(token.balance(player), 90);
    }
    assert_eq!(token.balance(&treasury_vault), 4);
    assert_eq!(token.balance(&contract_id), 0);
    assert_eq!(client.get_escrowed_balance(&token.address), 0);
}

#[test]
#[ignore = "runs 5,000 randomized settlement scenarios in contracts CI"]
fn fuzz_balance_conservation() {
    let scenario = (1i128..=(i128::MAX / 2), 0u32..=10_000, 0u32..=500);
    let mut runner = TestRunner::new(ProptestConfig::with_cases(5_000));

    runner
        .run(&scenario, |(buy_in, first_winner_bps, fee_bps)| {
            let second_winner_bps = 10_000 - first_winner_bps;
            let env = Env::default();
            env.mock_all_auths();

            let coordinator = Address::generate(&env);
            let player1 = Address::generate(&env);
            let player2 = Address::generate(&env);
            let token_admin = Address::generate(&env);
            let (token, token_admin_client) = create_token_contract(&env, &token_admin);

            token_admin_client.mint(&player1, &buy_in);
            token_admin_client.mint(&player2, &buy_in);

            let contract_id = env.register(ChessterEscrow, ());
            let client = ChessterEscrowClient::new(&env, &contract_id);
            client.init(&coordinator, &0);
            client.set_tournament_fee_bps(&fee_bps);
            client.add_supported_token(&token.address);

            approve(&env, &token, &player1, &contract_id, buy_in);
            approve(&env, &token, &player2, &contract_id, buy_in);

            let tournament_id = String::from_str(&env, "FUZZ_CONSERVATION");
            client.create_tournament(&tournament_id, &buy_in, &2, &2, &0, &token.address);
            client.join_tournament(&tournament_id, &player1);
            client.join_tournament(&tournament_id, &player2);

            let total_pool = buy_in * 2;
            let tournament = client.get_tournament(&tournament_id);
            prop_assert_eq!(tournament.players.len(), 2);
            prop_assert_eq!(tournament.total_pool, total_pool);

            let winners = vec![&env, player1.clone(), player2.clone()];
            let payout_bps = vec![&env, first_winner_bps, second_winner_bps];
            client.complete_tournament(&tournament_id, &winners, &payout_bps);

            let rake = (total_pool / BPS_DENOMINATOR) * fee_bps as i128
                + ((total_pool % BPS_DENOMINATOR) * fee_bps as i128) / BPS_DENOMINATOR;
            let net_pool = total_pool - rake;
            let first_payout = (net_pool / BPS_DENOMINATOR) * first_winner_bps as i128
                + ((net_pool % BPS_DENOMINATOR) * first_winner_bps as i128) / BPS_DENOMINATOR;
            let second_payout = net_pool - first_payout;
            let player1_balance = token.balance(&player1);
            let player2_balance = token.balance(&player2);
            let coordinator_balance = token.balance(&coordinator);

            prop_assert_eq!(player1_balance, first_payout);
            prop_assert_eq!(player2_balance, second_payout);
            prop_assert_eq!(coordinator_balance, rake);
            prop_assert_eq!(token.balance(&contract_id), 0);
            prop_assert_eq!(client.get_escrowed_balance(&token.address), 0);
            prop_assert_eq!(
                player1_balance + player2_balance + coordinator_balance,
                total_pool
            );

            Ok(())
        })
        .unwrap();
}

#[test]
fn test_tournament_rejects_duplicate_and_full_registration() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let p1 = Address::generate(&env);
    let p2 = Address::generate(&env);
    let p3 = Address::generate(&env);
    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    for player in [&p1, &p2, &p3] {
        token_admin_client.mint(player, &100);
    }

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &0);
    client.add_supported_token(&token.address);
    for player in [&p1, &p2, &p3] {
        approve(&env, &token, player, &contract_id, 10);
    }

    let tournament_id = String::from_str(&env, "TOURN_ERRORS");
    client.create_tournament(&tournament_id, &10, &2, &2, &0, &token.address);
    client.join_tournament(&tournament_id, &p1);
    let duplicate = client.try_join_tournament(&tournament_id, &p1);
    assert!(duplicate.is_err());
    client.join_tournament(&tournament_id, &p2);
    let full = client.try_join_tournament(&tournament_id, &p3);
    assert!(full.is_err());
}

#[test]
fn test_tournament_completion_requires_coordinator_auth() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player, &100);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &0);
    client.add_supported_token(&token.address);
    approve(&env, &token, &player, &contract_id, 10);
    let tournament_id = String::from_str(&env, "TOURN_AUTH");
    client.create_tournament(&tournament_id, &10, &2, &1, &0, &token.address);
    client.join_tournament(&tournament_id, &player);

    env.set_auths(&[]);
    let winners = vec![&env, player];
    let payout_bps = vec![&env, 10000_u32];
    let unauthorized = client.try_complete_tournament(&tournament_id, &winners, &payout_bps);
    assert!(unauthorized.is_err());
}

#[test]
fn test_tournament_prize_pool_lifecycle() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let p1 = Address::generate(&env);
    let p2 = Address::generate(&env);
    let p3 = Address::generate(&env);
    let p4 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&p1, &1000);
    token_admin_client.mint(&p2, &1000);
    token_admin_client.mint(&p3, &1000);
    token_admin_client.mint(&p4, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &250); // 2.5% platform fee
    client.set_tournament_fee_bps(&250);
    client.add_supported_token(&token.address);

    let tournament_id = String::from_str(&env, "TOURN_MULTI_WINNER");

    approve(&env, &token, &p1, &contract_id, 1000);
    approve(&env, &token, &p2, &contract_id, 1000);
    approve(&env, &token, &p3, &contract_id, 1000);
    approve(&env, &token, &p4, &contract_id, 1000);

    client.create_tournament(&tournament_id, &200, &4, &2, &1000, &token.address);

    client.join_tournament(&tournament_id, &p1);
    client.join_tournament(&tournament_id, &p2);
    client.join_tournament(&tournament_id, &p3);
    client.join_tournament(&tournament_id, &p4);

    let t = client.get_tournament(&tournament_id);
    assert_eq!(t.total_pool, 800);
    assert_eq!(t.status, TournamentStatus::Active);
    assert_eq!(client.get_escrowed_balance(&token.address), 800);

    // Invalid payout BPS sum check (9000 != 10000)
    let bad_bps = vec![&env, 5000_u32, 3000_u32, 1000_u32];
    let bad_winners = vec![&env, p1.clone(), p2.clone(), p3.clone()];
    let res = client.try_complete_tournament(&tournament_id, &bad_winners, &bad_bps);
    assert!(res.is_err());

    // Valid distribution: 50%, 30%, 20%
    let winners = vec![&env, p1.clone(), p2.clone(), p3.clone()];
    let payout_bps = vec![&env, 5000_u32, 3000_u32, 2000_u32];
    client.complete_tournament(&tournament_id, &winners, &payout_bps);

    let completed = client.get_tournament(&tournament_id);
    assert_eq!(completed.status, TournamentStatus::Completed);
    // Total pool: 800. Rake: 2.5% = 20. Net pool = 780.
    // P1: 50% = 390 -> 1000 - 200 + 390 = 1190.
    // P2: 30% = 234 -> 1000 - 200 + 234 = 1034.
    // P3: 20% = 156 -> 1000 - 200 + 156 = 956.
    // P4: 0%  = 0   -> 1000 - 200 = 800.
    // Coordinator: 20.
    assert_eq!(token.balance(&p1), 1190);
    assert_eq!(token.balance(&p2), 1034);
    assert_eq!(token.balance(&p3), 956);
    assert_eq!(token.balance(&p4), 800);
    assert_eq!(token.balance(&coordinator), 20);
    assert_eq!(client.get_escrowed_balance(&token.address), 0);
    assert_eq!(token.balance(&contract_id), 0);
}

#[test]
fn test_tournament_refund_workflow() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let p1 = Address::generate(&env);
    let p2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&p1, &1000);
    token_admin_client.mint(&p2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);
    client.add_supported_token(&token.address);

    // Scenario 1: Coordinator cancels tournament
    let tourn_cancel = String::from_str(&env, "TOURN_CANCEL");
    approve(&env, &token, &p1, &contract_id, 1000);
    client.create_tournament(&tourn_cancel, &200, &4, &2, &1000, &token.address);
    client.join_tournament(&tourn_cancel, &p1);
    assert_eq!(token.balance(&p1), 800);
    assert_eq!(client.get_escrowed_balance(&token.address), 200);

    client.cancel_tournament(&tourn_cancel);
    let t = client.get_tournament(&tourn_cancel);
    assert_eq!(t.status, TournamentStatus::Cancelled);

    // Non-participant cannot claim
    let err_unauth = client.try_claim_tournament_refund(&tourn_cancel, &p2);
    assert!(err_unauth.is_err());

    // P1 claims refund
    assert!(!client.is_refund_claimed(&tourn_cancel, &p1));
    client.claim_tournament_refund(&tourn_cancel, &p1);
    assert_eq!(token.balance(&p1), 1000);
    assert!(client.is_refund_claimed(&tourn_cancel, &p1));
    assert_eq!(client.get_escrowed_balance(&token.address), 0);

    // Double refund fails
    let err_double = client.try_claim_tournament_refund(&tourn_cancel, &p1);
    assert!(err_double.is_err());

    // Scenario 2: Quorum failure triggers self-service refund past deadline
    env.ledger().set_timestamp(100);
    let tourn_quorum = String::from_str(&env, "TOURN_QUORUM");
    approve(&env, &token, &p2, &contract_id, 1000);
    client.create_tournament(&tourn_quorum, &150, &4, &3, &500, &token.address);
    client.join_tournament(&tourn_quorum, &p1);
    client.join_tournament(&tourn_quorum, &p2);

    assert_eq!(token.balance(&p1), 850);
    assert_eq!(token.balance(&p2), 850);
    assert_eq!(client.get_escrowed_balance(&token.address), 300);

    // Prior to deadline, refund cannot be claimed without cancellation
    let err_early = client.try_claim_tournament_refund(&tourn_quorum, &p1);
    assert!(err_early.is_err());

    // Advance timestamp past deadline
    env.ledger().set_timestamp(600);

    // Self-service refund succeeds and sets status to Cancelled
    client.claim_tournament_refund(&tourn_quorum, &p1);
    assert_eq!(token.balance(&p1), 1000);
    assert_eq!(
        client.get_tournament(&tourn_quorum).status,
        TournamentStatus::Cancelled
    );

    client.claim_tournament_refund(&tourn_quorum, &p2);
    assert_eq!(token.balance(&p2), 1000);
    assert_eq!(client.get_escrowed_balance(&token.address), 0);
    assert_eq!(token.balance(&contract_id), 0);
}

// ---------------------------------------------------------------------------
// Issue #221 â€” Tournament Tiered Rake & Treasury Protocol Fee Deduction
// ---------------------------------------------------------------------------

#[test]
fn test_tournament_fee_deduction() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let treasury_vault = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_supported_token(&token.address);
    client.set_treasury_vault(&treasury_vault);

    // Initial fee defaults to 0
    assert_eq!(client.get_tournament_fee_bps(), 0);

    // Verify calculate_tournament_rake pure logic
    let (net, rake) = client.calculate_tournament_rake(&1000, &500);
    assert_eq!(rake, 50);
    assert_eq!(net, 950);

    // Set tournament fee to 500 BPS (5%)
    client.set_tournament_fee_bps(&500);
    assert_eq!(client.get_tournament_fee_bps(), 500);

    let tournament_id = String::from_str(&env, "TOURN_FEE_1");
    let payout_bps = vec![&env, 7500_u32, 2500_u32];

    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    client.create_tournament(&tournament_id, &100, &8, &2, &0, &token.address);
    client.join_tournament(&tournament_id, &player1);
    client.join_tournament(&tournament_id, &player2);

    let tournament_before = client.get_tournament(&tournament_id);
    assert_eq!(tournament_before.total_pool, 200);

    let final_rankings = vec![&env, player1.clone(), player2.clone()];
    client.complete_tournament(&tournament_id, &final_rankings, &payout_bps);

    // total_pool = 200, rake = 200 * 500 / 10000 = 10
    // net_prize_pool = 190
    // w1 share = (150 * 190) / 200 = 142
    // w2 share = 190 - 142 = 48
    // treasury balance = 10 (rake)
    assert_eq!(token.balance(&treasury_vault), 10);
    // player1: spent 100 (balance 900) + received 142 = 1042
    assert_eq!(token.balance(&player1), 1042);
    // player2: spent 100 (balance 900) + received 48 = 948
    assert_eq!(token.balance(&player2), 948);

    // Verify zero token leakage or dust accumulation in the escrow contract balance
    assert_eq!(token.balance(&contract_id), 0);
    // Verify conservation: 10 + 142 + 48 == 200
    assert_eq!(
        10 + (token.balance(&player1) - 900) + (token.balance(&player2) - 900),
        200
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn test_set_tournament_fee_bps_rejects_above_cap() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);

    // Attempting to set fee > 500 BPS must panic with InvalidWager (error #3)
    client.set_tournament_fee_bps(&501);
}

// ---------------------------------------------------------------------------
// Issue #222 â€” Tournament Stage Checkpoints and Disqualification Slashing
// ---------------------------------------------------------------------------

#[test]
fn test_disqualification_and_redistribution() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let treasury_vault = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_supported_token(&token.address);
    client.set_treasury_vault(&treasury_vault);

    let tournament_id = String::from_str(&env, "TOURN_DQ_1");
    let payout_bps = vec![&env, 7500_u32, 2500_u32];

    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    client.create_tournament(&tournament_id, &100, &8, &2, &0, &token.address);
    client.join_tournament(&tournament_id, &player1);
    client.join_tournament(&tournament_id, &player2);

    // Record stage checkpoint
    client.record_stage_checkpoint(&tournament_id, &2);
    let tournament_stg = client.get_tournament(&tournament_id);
    assert_eq!(tournament_stg.stage, 2);

    // Disqualify player1 (cheating / forfeit reason code 99)
    client.disqualify_participant(&tournament_id, &player1, &99);
    let tournament_dq = client.get_tournament(&tournament_id);
    assert!(tournament_dq.disqualified.get(player1.clone()).unwrap());

    // Complete tournament with player1 ranked 1st and player2 ranked 2nd
    let final_rankings = vec![&env, player1.clone(), player2.clone()];
    client.complete_tournament(&tournament_id, &final_rankings, &payout_bps);

    // Player1 was disqualified: prize (150) must NOT be received by player1,
    // but slashed and transferred directly to treasury
    assert_eq!(token.balance(&player1), 900); // Spent 100 on buy-in, receives 0 prize
    assert_eq!(token.balance(&player2), 950); // Spent 100 on buy-in, receives 50 prize
    assert_eq!(token.balance(&treasury_vault), 150); // Slashed prize routed to treasury

    // Escrow contract balance must be strictly 0 (no dust, complete conservation)
    assert_eq!(token.balance(&contract_id), 0);
}

// ---------------------------------------------------------------------------
// Issue #40 â€” Multi-Token Whitelist Registry
// ---------------------------------------------------------------------------

#[test]
fn test_whitelist_add_remove_and_query() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token, _admin_client) = create_token_contract(&env, &token_admin);
    let (other_token, _admin_client2) = create_token_contract(&env, &token_admin);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);

    assert!(!client.is_token_whitelisted(&token.address));
    assert_eq!(client.get_whitelisted_tokens().len(), 0);

    client.add_whitelisted_token(&token.address);
    assert!(client.is_token_whitelisted(&token.address));
    assert!(!client.is_token_whitelisted(&other_token.address));
    assert_eq!(client.get_whitelisted_tokens().len(), 1);

    client.add_whitelisted_token(&other_token.address);
    assert_eq!(client.get_whitelisted_tokens().len(), 2);

    client.remove_whitelisted_token(&token.address);
    assert!(!client.is_token_whitelisted(&token.address));
    assert!(client.is_token_whitelisted(&other_token.address));
    assert_eq!(client.get_whitelisted_tokens().len(), 1);
}

#[test]
#[should_panic(expected = "HostError")]
fn test_create_match_rejects_non_whitelisted_token() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);
    // Note: token is never whitelisted.

    let game_code = String::from_str(&env, "GAME_NOT_WL");
    client.create_match(&game_code, &player1, &token.address, &100);
}

#[test]
fn test_create_match_succeeds_after_whitelisting() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    let game_code = String::from_str(&env, "GAME_WL_OK");
    approve(&env, &token, &player1, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);

    let match_data = client.get_match(&game_code);
    assert_eq!(match_data.status, MatchStatus::Pending);
}

#[test]
#[should_panic(expected = "HostError")]
fn test_create_match_rejects_after_delisting() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);
    client.remove_whitelisted_token(&token.address);

    let game_code = String::from_str(&env, "GAME_DELISTED");
    approve(&env, &token, &player1, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);
}

// ---------------------------------------------------------------------------
// Issue #39 â€” Match Forfeit Resolution Trigger for Disconnects
// ---------------------------------------------------------------------------

#[test]
fn test_forfeit_match_pays_non_forfeiting_player() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500); // 5% fee
    client.add_whitelisted_token(&token.address);

    let game_code = String::from_str(&env, "GAME_FORFEIT");
    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);

    // Player 1 disconnects and never reconnects; coordinator forfeits them.
    client.forfeit_match(&game_code, &player1);

    let match_data = client.get_match(&game_code);
    assert_eq!(match_data.status, MatchStatus::Resolved);
    assert_eq!(match_data.winner, Some(player2.clone()));

    // Total staked = 200, 5% fee = 10, player2 gets 190.
    assert_eq!(token.balance(&player2), 1090);
    assert_eq!(token.balance(&coordinator), 10);
    assert_eq!(token.balance(&contract_id), 0);
}

#[test]
fn test_forfeit_match_other_color() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    let game_code = String::from_str(&env, "GAME_FORFEIT_2");
    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);

    // Player 2 disconnects this time.
    client.forfeit_match(&game_code, &player2);

    let match_data = client.get_match(&game_code);
    assert_eq!(match_data.winner, Some(player1.clone()));
    assert_eq!(token.balance(&player1), 1090);
}

#[test]
#[should_panic(expected = "HostError")]
fn test_forfeit_match_rejects_non_participant() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let outsider = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    let game_code = String::from_str(&env, "GAME_FORFEIT_BAD");
    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);

    client.forfeit_match(&game_code, &outsider);
}

#[test]
#[should_panic(expected = "HostError")]
fn test_forfeit_match_rejects_pending_match() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    let game_code = String::from_str(&env, "GAME_FORFEIT_PENDING");
    approve(&env, &token, &player1, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);
    // Player 2 never joined â€” match is still Pending, not Active.

    client.forfeit_match(&game_code, &player1);
}

#[test]
fn test_forfeit_match_settles_side_pool() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let spectator = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);
    token_admin_client.mint(&spectator, &500);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    let game_code = String::from_str(&env, "GAME_FORFEIT_BET");
    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    approve(&env, &token, &spectator, &contract_id, 500);
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);

    // Spectator bets on player2 (the eventual winner-by-forfeit).
    client.place_side_bet(&game_code, &spectator, &player2, &100);

    client.forfeit_match(&game_code, &player1);

    // Sole bettor on the winning side gets their stake back (no other side stakes).
    assert_eq!(token.balance(&spectator), 500);
}

// ---------------------------------------------------------------------------
// Issue #24 â€” Typed Soroban Contract Events on Escrow State Transitions
// ---------------------------------------------------------------------------

#[test]
fn test_events_emitted_on_lifecycle_transitions() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    let game_code = String::from_str(&env, "GAME_EVENTS");
    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);

    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);
    let events_after_create = env.events().all();
    assert!(events_after_create
        .iter()
        .any(|(id, _, _)| id == contract_id));

    client.join_match(&game_code, &player2);
    let events_after_join = env.events().all();
    assert!(events_after_join.iter().any(|(id, _, _)| id == contract_id));

    client.resolve_match(&game_code, &Some(player1.clone()));
    let events_after_resolve = env.events().all();
    assert!(events_after_resolve
        .iter()
        .any(|(id, _, _)| id == contract_id));
}

#[test]
fn test_event_emitted_on_forfeit() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    let game_code = String::from_str(&env, "GAME_EVENT_FORFEIT");
    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);

    client.forfeit_match(&game_code, &player1);
    let events_after = env.events().all();
    assert!(events_after.iter().any(|(id, _, _)| id == contract_id));
}

#[test]
fn test_event_emitted_on_refund() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    let game_code = String::from_str(&env, "GAME_EVENT_REFUND");
    approve(&env, &token, &player1, &contract_id, 1000);

    env.ledger().with_mut(|li| {
        li.timestamp = 1000;
    });
    approve(&env, &token, &player1, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);

    env.ledger().with_mut(|li| {
        li.timestamp = 4601;
    });

    client.refund_after_timeout(&game_code);
    let events_after = env.events().all();
    assert!(events_after.iter().any(|(id, _, _)| id == contract_id));
}

#[test]
fn test_gc_stale_matches() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);

    env.ledger().with_mut(|li| {
        li.timestamp = 1_000_000;
    });

    let game_code = String::from_str(&env, "GC_MATCH_1");
    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);
    client.resolve_match(&game_code, &Some(player1.clone()));

    // At 10 days later (<30 days), match is not stale yet.
    env.ledger().with_mut(|li| {
        li.timestamp = 1_000_000 + (10 * 86400);
    });

    let game_codes = vec![&env, game_code.clone()];
    let cleaned = client.gc_stale_matches(&game_codes);
    assert_eq!(cleaned, 0);

    // At 31 days later (>=30 days), match becomes stale and is cleaned up.
    env.ledger().with_mut(|li| {
        li.timestamp = 1_000_000 + (31 * 86400);
    });

    let cleaned = client.gc_stale_matches(&game_codes);
    assert_eq!(cleaned, 1);

    // Match should now be removed from persistent storage.
    let result = client.try_get_match(&game_code);
    assert!(result.is_err());
}

#[test]
fn test_gc_stale_single_match() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);

    env.ledger().with_mut(|li| {
        li.timestamp = 2_000_000;
    });

    let game_code = String::from_str(&env, "GC_SINGLE_1");
    approve(&env, &token, &player1, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);
    client.request_cancellation(&game_code, &player1);

    // Rejects GC while under 30 days old.
    assert!(!client.gc_stale_match(&game_code));

    // After 30 days, single match GC succeeds.
    env.ledger().with_mut(|li| {
        li.timestamp = 2_000_000 + (30 * 86400);
    });

    assert!(client.gc_stale_match(&game_code));
    assert!(client.try_get_match(&game_code).is_err());
}

#[test]
fn test_gc_stale_matches_empty_batch() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);

    let empty_codes: Vec<String> = Vec::new(&env);
    let cleaned = client.gc_stale_matches(&empty_codes);
    assert_eq!(cleaned, 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #26)")]
fn test_gc_stale_matches_exceeds_limit_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);

    let mut codes = Vec::new(&env);
    for _ in 0..(MAX_BATCH_GC_MATCHES + 1) {
        codes.push_back(String::from_str(&env, "OVER_LIMIT"));
    }
    client.gc_stale_matches(&codes);
}

#[test]
fn test_gc_stale_matches_oversized_batch_fails_atomically() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);

    env.ledger().with_mut(|li| {
        li.timestamp = 1_000_000;
    });

    let game_code = String::from_str(&env, "GC_ATOMIC_1");
    approve(&env, &token, &player1, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);
    client.request_cancellation(&game_code, &player1);

    // Fast-forward past 30 days
    env.ledger().with_mut(|li| {
        li.timestamp = 1_000_000 + (31 * 86400);
    });

    // Match is now stale and eligible. Put it first in an oversized batch.
    let mut codes = Vec::new(&env);
    codes.push_back(game_code.clone());
    for _ in 0..MAX_BATCH_GC_MATCHES {
        codes.push_back(String::from_str(&env, "DUMMY_EXTRA"));
    }
    assert_eq!(codes.len(), MAX_BATCH_GC_MATCHES + 1);

    let result = client.try_gc_stale_matches(&codes);
    assert!(result.is_err());

    // Verify atomic failure: match was NOT deleted from storage
    let m = client.try_get_match(&game_code);
    assert!(m.is_ok());
}

#[test]
fn test_gc_stale_matches_at_limit() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &2000);
    token_admin_client.mint(&player2, &2000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);

    env.ledger().with_mut(|li| {
        li.timestamp = 1_000_000;
    });

    // Create 2 eligible matches
    let gc1 = String::from_str(&env, "AT_LIMIT_1");
    let gc2 = String::from_str(&env, "AT_LIMIT_2");
    approve(&env, &token, &player1, &contract_id, 2000);
    approve(&env, &token, &player2, &contract_id, 2000);

    client.create_match(&gc1, &player1, &token.address, &100);
    client.join_match(&gc1, &player2);
    client.resolve_match(&gc1, &Some(player1.clone()));

    client.create_match(&gc2, &player1, &token.address, &100);
    client.request_cancellation(&gc2, &player1);

    // Fast-forward past 30 days
    env.ledger().with_mut(|li| {
        li.timestamp = 1_000_000 + (31 * 86400);
    });

    // Create a batch of exactly MAX_BATCH_GC_MATCHES (25)
    let mut codes = Vec::new(&env);
    codes.push_back(gc1.clone());
    codes.push_back(gc2.clone());
    for _ in 2..MAX_BATCH_GC_MATCHES {
        codes.push_back(String::from_str(&env, "UNKNOWN_CODE"));
    }
    assert_eq!(codes.len(), MAX_BATCH_GC_MATCHES);

    let cleaned = client.gc_stale_matches(&codes);
    assert_eq!(cleaned, 2);

    assert!(client.try_get_match(&gc1).is_err());
    assert!(client.try_get_match(&gc2).is_err());
}

#[test]
fn test_gc_stale_matches_mixed_batch() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &5000);
    token_admin_client.mint(&player2, &5000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);

    let base_time = 10_000_000;
    env.ledger().with_mut(|li| {
        li.timestamp = base_time;
    });
    approve(&env, &token, &player1, &contract_id, 5000);
    approve(&env, &token, &player2, &contract_id, 5000);

    // 1. Eligible old resolved match (> 30 days)
    let gc_resolved_old = String::from_str(&env, "MIXED_RESOLVED_OLD");
    client.create_match(&gc_resolved_old, &player1, &token.address, &100);
    client.join_match(&gc_resolved_old, &player2);
    client.resolve_match(&gc_resolved_old, &Some(player1.clone()));

    // 2. Eligible old refunded match (> 30 days)
    let gc_refunded_old = String::from_str(&env, "MIXED_REFUNDED_OLD");
    client.create_match(&gc_refunded_old, &player1, &token.address, &100);
    client.request_cancellation(&gc_refunded_old, &player1);

    // 3. Recent resolved match (created 25 days later, so only 10 days old when advanced to 35 days)
    env.ledger().with_mut(|li| {
        li.timestamp = base_time + (25 * 86400);
    });
    let gc_resolved_recent = String::from_str(&env, "MIXED_RESOLVED_RECENT");
    client.create_match(&gc_resolved_recent, &player1, &token.address, &100);
    client.join_match(&gc_resolved_recent, &player2);
    client.resolve_match(&gc_resolved_recent, &Some(player1.clone()));

    // Advance ledger to 35 days after base_time
    env.ledger().with_mut(|li| {
        li.timestamp = base_time + (35 * 86400);
    });

    // 4. Active match (joined, not resolved/refunded)
    let gc_active = String::from_str(&env, "MIXED_ACTIVE");
    client.create_match(&gc_active, &player1, &token.address, &100);
    client.join_match(&gc_active, &player2);

    // 5. Pending match (not joined)
    let gc_pending = String::from_str(&env, "MIXED_PENDING");
    client.create_match(&gc_pending, &player1, &token.address, &100);

    // 6. Unknown / nonexistent match
    let gc_unknown = String::from_str(&env, "MIXED_NONEXISTENT");

    let mixed_codes = vec![
        &env,
        gc_resolved_old.clone(),
        gc_refunded_old.clone(),
        gc_resolved_recent.clone(),
        gc_active.clone(),
        gc_pending.clone(),
        gc_unknown.clone(),
    ];

    let cleaned = client.gc_stale_matches(&mixed_codes);
    assert_eq!(cleaned, 2);

    // Eligible entries removed
    assert!(client.try_get_match(&gc_resolved_old).is_err());
    assert!(client.try_get_match(&gc_refunded_old).is_err());

    // Ineligible entries preserved
    let m_recent = client.get_match(&gc_resolved_recent);
    assert_eq!(m_recent.status, MatchStatus::Resolved);

    let m_active = client.get_match(&gc_active);
    assert_eq!(m_active.status, MatchStatus::Active);

    let m_pending = client.get_match(&gc_pending);
    assert_eq!(m_pending.status, MatchStatus::Pending);
}

#[test]
fn test_gc_stale_matches_requires_coordinator_auth() {
    let env = Env::default();
    let coordinator = Address::generate(&env);
    let attacker = Address::generate(&env);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &coordinator,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &contract_id,
            fn_name: "init",
            args: (&coordinator, 500u32).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.init(&coordinator, &500);

    let codes = vec![&env, String::from_str(&env, "CODE1")];

    // Attempt gc_stale_matches with attacker auth
    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &attacker,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &contract_id,
            fn_name: "gc_stale_matches",
            args: (codes.clone(),).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    assert!(client.try_gc_stale_matches(&codes).is_err());

    // Attempt single gc_stale_match with attacker auth
    let code = String::from_str(&env, "CODE1");
    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &attacker,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &contract_id,
            fn_name: "gc_stale_match",
            args: (code.clone(),).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    assert!(client.try_gc_stale_match(&code).is_err());
}

#[test]
fn test_native_xlm_payment_wrapping() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (native_token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);

    // Set native XLM token address
    client.set_native_xlm_address(&native_token.address);
    assert_eq!(
        client.get_native_xlm_address(),
        Some(native_token.address.clone())
    );

    let game_code = String::from_str(&env, "NATIVE_XLM_GAME");
    approve(&env, &native_token, &player1, &contract_id, 1000);
    approve(&env, &native_token, &player2, &contract_id, 1000);

    client.create_native_match(&game_code, &player1, &100);
    client.join_native_match(&game_code, &player2);

    let match_data = client.get_match(&game_code);
    assert_eq!(match_data.status, MatchStatus::Active);
    assert_eq!(match_data.token, native_token.address);
    assert_eq!(match_data.total_staked, 200);
}

// ===========================================================================
// Additional tests: wager limits, timeouts, Elo, treasury vault, refunds, and
// the new Coordinator Key Rotation (multi-sig), Reentrancy Guard, Balance
// Invariant, and Upgradeability features.
// ===========================================================================

use soroban_sdk::BytesN;

#[test]
fn test_wager_limits_config() {
    let env = Env::default();
    env.mock_all_auths();
    let coordinator = Address::generate(&env);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);

    // Defaults
    let limits = client.get_wager_limits();
    assert_eq!(limits.min_wager, 1);
    assert_eq!(limits.max_wager, i128::MAX);

    // Set global limits
    client.set_wager_limits(&100, &5000);
    let limits = client.get_wager_limits();
    assert_eq!(limits.min_wager, 100);
    assert_eq!(limits.max_wager, 5000);
    assert_eq!(client.get_min_wager(), 100);
    assert_eq!(client.get_max_wager(), 5000);

    // Individually
    client.set_min_wager(&200);
    assert_eq!(client.get_min_wager(), 200);
    assert_eq!(client.get_max_wager(), 5000);
    client.set_max_wager(&8000);
    assert_eq!(client.get_max_wager(), 8000);

    // Invalid (min > max) panics
    assert!(client.try_set_wager_limits(&9000, &1000).is_err());
    // Non-positive min panics
    assert!(client.try_set_wager_limits(&0, &1000).is_err());
}

#[test]
fn test_token_wager_limits_config() {
    let env = Env::default();
    env.mock_all_auths();
    let coordinator = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token, _) = create_token_contract(&env, &token_admin);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);

    client.set_token_wager_limits(&token.address, &10, &100);
    let limits = client.get_token_wager_limits(&token.address);
    assert_eq!(limits.min_wager, 10);
    assert_eq!(limits.max_wager, 100);
    assert_eq!(client.get_token_min_wager(&token.address), 10);

    // Remove falls back to global
    client.remove_token_wager_limits(&token.address);
    let limits = client.get_token_wager_limits(&token.address);
    assert_eq!(limits.min_wager, 1);
}

#[test]
fn test_match_timeout_config() {
    let env = Env::default();
    env.mock_all_auths();
    let coordinator = Address::generate(&env);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);

    assert_eq!(client.get_match_timeout(), 3600);
    client.set_match_timeout(&1800);
    assert_eq!(client.get_match_timeout(), 1800);
    // Zero rejected
    assert!(client.try_set_match_timeout(&0).is_err());
}

#[test]
fn test_elo_default_and_update() {
    let env = Env::default();
    env.mock_all_auths();
    let coordinator = Address::generate(&env);
    let player = Address::generate(&env);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);

    assert_eq!(client.get_player_elo(&player), 1200);
    client.update_player_elo(&player, &1600);
    assert_eq!(client.get_player_elo(&player), 1600);
}

#[test]
fn test_treasury_vault_config_and_fee_routing() {
    let env = Env::default();
    env.mock_all_auths();
    let coordinator = Address::generate(&env);
    let vault = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&vault, &10_000);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);

    assert_eq!(client.get_treasury_vault(), None);
    client.set_treasury_vault(&vault);
    assert_eq!(client.get_treasury_vault(), Some(vault.clone()));

    let p1 = Address::generate(&env);
    let p2 = Address::generate(&env);
    token_admin_client.mint(&p1, &1000);
    token_admin_client.mint(&p2, &1000);
    client.add_whitelisted_token(&token.address);

    let gc = String::from_str(&env, "VAULT_GAME");
    approve(&env, &token, &p1, &contract_id, 1000);
    approve(&env, &token, &p2, &contract_id, 1000);
    client.create_match(&gc, &p1, &token.address, &200);
    client.join_match(&gc, &p2);

    let bal_before = token.balance(&vault);
    client.resolve_match(&gc, &Some(p2.clone()));
    // fee = total_staked(400) * 500bps / 10000 = 20
    assert_eq!(token.balance(&vault), bal_before + 20);
}

#[test]
fn test_claim_refund_flow() {
    let env = Env::default();
    env.mock_all_auths();
    let coordinator = Address::generate(&env);
    let p1 = Address::generate(&env);
    let p2 = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&p1, &1000);
    token_admin_client.mint(&p2, &1000);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    let gc = String::from_str(&env, "REFUND_GAME");
    approve(&env, &token, &p1, &contract_id, 1000);
    approve(&env, &token, &p2, &contract_id, 1000);
    client.create_match(&gc, &p1, &token.address, &100);
    client.join_match(&gc, &p2);

    // Not expired yet -> claim fails
    assert!(client.try_claim_refund(&gc, &p1).is_err());

    // Advance past timeout
    env.ledger().with_mut(|li| {
        li.timestamp = 10_000;
    });
    client.claim_refund(&gc, &p1);
    let m = client.get_match(&gc);
    assert_eq!(m.status, MatchStatus::Refunded);
    assert_eq!(token.balance(&p1), 1000);
}

#[test]
fn test_balance_invariant_escrowed_tracking() {
    let env = Env::default();
    env.mock_all_auths();
    let coordinator = Address::generate(&env);
    let p1 = Address::generate(&env);
    let p2 = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&p1, &1000);
    token_admin_client.mint(&p2, &1000);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    let gc = String::from_str(&env, "INV_GAME");
    approve(&env, &token, &p1, &contract_id, 1000);
    approve(&env, &token, &p2, &contract_id, 1000);
    client.create_match(&gc, &p1, &token.address, &100);
    client.join_match(&gc, &p2);

    // Escrowed == 200 (both wagers)
    assert_eq!(client.get_escrowed_balance(&token.address), 200);
    // Actual contract balance covers escrowed obligations
    assert!(client.get_treasury(&token.address) >= 200);

    // Side bet increases escrowed balance
    let spectator = Address::generate(&env);
    token_admin_client.mint(&spectator, &1000);
    approve(&env, &token, &spectator, &contract_id, 1000);
    client.place_side_bet(&gc, &spectator, &p1, &50);
    assert_eq!(client.get_escrowed_balance(&token.address), 250);

    // Resolution releases all escrowed funds
    client.resolve_match(&gc, &Some(p2.clone()));
    assert_eq!(client.get_escrowed_balance(&token.address), 0);
}

#[test]
fn test_coordinator_rotation_multisig() {
    let env = Env::default();
    env.mock_all_auths();
    let coordinator = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let new_coord = Address::generate(&env);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);

    // Initial signers = [coordinator]
    assert_eq!(client.get_admin_signers(), vec![&env, coordinator.clone()]);

    // Add second signer
    client.add_admin_signer(&signer2);
    assert_eq!(
        client.get_admin_signers(),
        vec![&env, coordinator.clone(), signer2.clone()]
    );

    // Single approval does not rotate yet
    client.propose_coordinator_rotation(&coordinator, &new_coord);
    assert_eq!(client.get_coordinator(), coordinator);
    assert_eq!(
        client.get_pending_rotation().unwrap().proposed_coordinator,
        new_coord
    );

    // Second distinct signer approves -> rotation executes
    client.approve_coordinator_rotation(&signer2, &new_coord);
    assert_eq!(client.get_coordinator(), new_coord);
    assert!(client.get_pending_rotation().is_none());
}

#[test]
fn test_admin_action_multisig_threshold_flow() {
    let env = Env::default();
    env.mock_all_auths();
    let coordinator = Address::generate(&env);
    let guardian1 = Address::generate(&env);
    let guardian2 = Address::generate(&env);
    let guardian3 = Address::generate(&env);
    let outsider = Address::generate(&env);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);

    let guardians = vec![
        &env,
        guardian1.clone(),
        guardian2.clone(),
        guardian3.clone(),
    ];
    client.set_guardians(&guardians, &2);
    assert_eq!(client.get_guardians(), guardians);
    assert_eq!(client.get_admin_threshold(), 2);

    let proposal_id: u64 = 7;
    let payload_hash = BytesN::from_array(&env, &[11u8; 32]);
    assert!(client
        .try_propose_admin_action(&outsider, &proposal_id, &payload_hash)
        .is_err());

    client.propose_admin_action(&guardian1, &proposal_id, &payload_hash);
    let proposal = client.get_admin_proposal(&proposal_id);
    assert_eq!(proposal.proposal_id, proposal_id);
    assert_eq!(proposal.payload_hash, payload_hash);
    assert_eq!(proposal.confirmations.len(), 1);

    assert!(client.try_execute_admin_action(&proposal_id).is_err());

    client.confirm_admin_action(&guardian2, &proposal_id);
    assert!(client.execute_admin_action(&proposal_id));
    assert!(client.get_admin_proposal(&proposal_id).executed);

    // Re-confirming the same guardian is a duplicate and must be rejected.
    assert!(client
        .try_confirm_admin_action(&guardian2, &proposal_id)
        .is_err());
}

#[test]
fn test_coordinator_rotation_requires_signer() {
    let env = Env::default();
    env.mock_all_auths();
    let coordinator = Address::generate(&env);
    let outsider = Address::generate(&env);
    let new_coord = Address::generate(&env);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);

    // outsider is not an authorized signer -> proposal rejected
    assert!(client
        .try_propose_coordinator_rotation(&outsider, &new_coord)
        .is_err());
}

#[test]
fn test_coordinator_rotation_rejects_duplicate_and_mismatch() {
    let env = Env::default();
    env.mock_all_auths();
    let coordinator = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let new_coord = Address::generate(&env);
    let other = Address::generate(&env);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);
    client.add_admin_signer(&signer2);

    client.propose_coordinator_rotation(&coordinator, &new_coord);

    // Same signer approving again is rejected
    assert!(client
        .try_approve_coordinator_rotation(&coordinator, &new_coord)
        .is_err());

    // A different proposed address while a proposal is pending is rejected
    assert!(client
        .try_propose_coordinator_rotation(&signer2, &other)
        .is_err());
}

#[test]
fn test_reentrancy_guard_allows_normal_flow() {
    let env = Env::default();
    env.mock_all_auths();
    let coordinator = Address::generate(&env);
    let p1 = Address::generate(&env);
    let p2 = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&p1, &1000);
    token_admin_client.mint(&p2, &1000);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    let gc = String::from_str(&env, "REENT_GAME");
    approve(&env, &token, &p1, &contract_id, 1000);
    approve(&env, &token, &p2, &contract_id, 1000);
    client.create_match(&gc, &p1, &token.address, &100);
    client.join_match(&gc, &p2);

    // Guarded resolve executes and releases the lock
    client.resolve_match(&gc, &Some(p2.clone()));

    // A second guarded path on a fresh match works after the previous lock released
    let gc2 = String::from_str(&env, "REENT_GAME2");
    approve(&env, &token, &p1, &contract_id, 1000);
    client.create_match(&gc2, &p1, &token.address, &100);
    client.cancel_pending_match(&gc2, &p1);
}

#[test]
fn test_upgrade_requires_coordinator() {
    let env = Env::default();
    let coordinator = Address::generate(&env);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    // Authorize the coordinator so init succeeds.
    env.mock_all_auths();
    client.init(&coordinator, &500);

    // Drop blanket auth: upgrade must enforce coordinator authorization and
    // therefore fail here (before any WASM deployment is even attempted).
    env.set_auths(&[]);
    let hash = BytesN::from_array(&env, &[0u8; 32]);
    assert!(client.try_upgrade(&hash).is_err());
}

// ---------------------------------------------------------------------------
// Issue #22 â€“ Contract Pause / Unpause (circuit breaker) tests
// ---------------------------------------------------------------------------

#[test]
fn test_is_paused_defaults_to_false() {
    let env = Env::default();
    env.mock_all_auths();
    let coordinator = Address::generate(&env);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);

    assert!(!client.is_paused());
}

#[test]
fn test_pause_sets_paused_flag() {
    let env = Env::default();
    env.mock_all_auths();
    let coordinator = Address::generate(&env);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);

    assert!(!client.is_paused());
    client.pause();
    assert!(client.is_paused());
}

#[test]
fn test_unpause_clears_paused_flag() {
    let env = Env::default();
    env.mock_all_auths();
    let coordinator = Address::generate(&env);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);

    client.pause();
    assert!(client.is_paused());
    client.unpause();
    assert!(!client.is_paused());
}

#[test]
fn test_pause_blocks_create_match() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &10_000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    approve(&env, &token, &player1, &contract_id, 10_000);

    // Pause the contract
    client.pause();

    let game_code = String::from_str(&env, "GAME_PAUSED");
    let result = client.try_create_match(&game_code, &player1, &token.address, &100);
    assert!(result.is_err());
}

#[test]
fn test_pause_blocks_join_match() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &10_000);
    token_admin_client.mint(&player2, &10_000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    approve(&env, &token, &player1, &contract_id, 10_000);
    approve(&env, &token, &player2, &contract_id, 10_000);

    let game_code = String::from_str(&env, "GAME_JOIN_PAUSED");
    // Player 1 creates while unpaused
    client.create_match(&game_code, &player1, &token.address, &100);

    // Pause before player 2 joins
    client.pause();

    let result = client.try_join_match(&game_code, &player2);
    assert!(result.is_err());
}

#[test]
fn test_pause_blocks_create_tournament() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, _) = create_token_contract(&env, &token_admin);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    client.pause();

    let tournament_id = String::from_str(&env, "TOURN_PAUSED");
    let result = client.try_create_tournament(&tournament_id, &100, &8, &2, &0, &token.address);
    assert!(result.is_err());
}

#[test]
fn test_pause_blocks_join_tournament() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &10_000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    let tournament_id = String::from_str(&env, "TOURN_JOIN_PAUSED");
    // Create tournament while unpaused
    client.create_tournament(&tournament_id, &100, &8, &2, &0, &token.address);

    // Pause before anyone joins
    client.pause();

    approve(&env, &token, &player1, &contract_id, 10_000);
    let result = client.try_join_tournament(&tournament_id, &player1);
    assert!(result.is_err());
}

#[test]
fn test_unpause_allows_create_match() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &10_000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);
    approve(&env, &token, &player1, &contract_id, 10_000);

    // Pause then unpause
    client.pause();
    assert!(client.is_paused());
    client.unpause();
    assert!(!client.is_paused());

    // create_match should succeed after unpausing
    let game_code = String::from_str(&env, "GAME_AFTER_UNPAUSE");
    client.create_match(&game_code, &player1, &token.address, &100);
    let m = client.get_match(&game_code);
    assert_eq!(m.status, MatchStatus::Pending);
}

#[test]
fn test_refund_allowed_while_paused() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &10_000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    approve(&env, &token, &player1, &contract_id, 10_000);

    env.ledger().with_mut(|li| li.timestamp = 1000);
    let game_code = String::from_str(&env, "GAME_REFUND_PAUSED");
    client.create_match(&game_code, &player1, &token.address, &100);

    // Pause the contract after match creation
    client.pause();

    // Fast-forward past the timeout
    env.ledger()
        .with_mut(|li| li.timestamp = 1000 + MATCH_EXPIRATION_SECS + 1);

    // refund_after_timeout should still work while paused
    client.refund_after_timeout(&game_code);

    let m = client.get_match(&game_code);
    assert_eq!(m.status, MatchStatus::Refunded);
    // Player 1 gets their wager back
    assert_eq!(token.balance(&player1), 10_000);
}

#[test]
fn test_pause_emits_paused_event() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);

    let events_before = env.events().all().len();
    client.pause();
    let events_after = env.events().all();
    assert!(events_after.len() > events_before);
}

#[test]
fn test_unpause_emits_unpaused_event() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);

    client.pause();
    client.unpause();
    let events_after = env.events().all();
    assert!(!events_after.is_empty());
}

#[test]
fn test_pause_requires_coordinator_auth() {
    let env = Env::default();
    // Do NOT mock all auths â€” only mock specific ones
    let coordinator = Address::generate(&env);
    let non_coordinator = Address::generate(&env);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    // init requires coordinator auth
    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &coordinator,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &contract_id,
            fn_name: "init",
            args: (&coordinator, 500u32).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.init(&coordinator, &500);

    // Calling pause as non_coordinator should fail
    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &non_coordinator,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &contract_id,
            fn_name: "pause",
            args: ().into_val(&env),
            sub_invokes: &[],
        },
    }]);
    // pause internally calls get_coordinator().require_auth() which will fail
    // because the actual coordinator is different from non_coordinator
    let result = client.try_pause();
    assert!(result.is_err());
}

#[test]
fn test_unpause_requires_coordinator_auth() {
    let env = Env::default();
    let coordinator = Address::generate(&env);
    let non_coordinator = Address::generate(&env);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &coordinator,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &contract_id,
            fn_name: "init",
            args: (&coordinator, 500u32).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.init(&coordinator, &500);

    // Pause with valid coordinator
    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &coordinator,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &contract_id,
            fn_name: "pause",
            args: ().into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.pause();

    // Attempt unpause as non_coordinator
    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &non_coordinator,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &contract_id,
            fn_name: "unpause",
            args: ().into_val(&env),
            sub_invokes: &[],
        },
    }]);
    let result = client.try_unpause();
    assert!(result.is_err());
}

#[test]
fn test_set_fee_bps_rejects_values_above_100_percent() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);

    let result = client.try_set_fee_bps(&10_001);

    assert!(result.is_err());
    assert_eq!(client.get_fee_bps(), 500);
}

#[test]
fn test_set_fee_bps_requires_coordinator_auth() {
    let env = Env::default();
    let coordinator = Address::generate(&env);
    let non_coordinator = Address::generate(&env);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &coordinator,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &contract_id,
            fn_name: "init",
            args: (&coordinator, 500u32).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.init(&coordinator, &500);

    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &non_coordinator,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &contract_id,
            fn_name: "set_fee_bps",
            args: (1000u32,).into_val(&env),
            sub_invokes: &[],
        },
    }]);

    let result = client.try_set_fee_bps(&1000);

    assert!(result.is_err());
    assert_eq!(client.get_fee_bps(), 500);
}

#[test]
fn test_contract_storage_ttl_auto_extension() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    let game_code = String::from_str(&env, "GAME_TTL_1");
    approve(&env, &token, &player1, &contract_id, 100);
    client.create_match(&game_code, &player1, &token.address, &100);

    // Auto-extend TTL
    client.extend_match_ttl(&game_code);

    let match_data = client.get_match(&game_code);
    assert_eq!(match_data.status, MatchStatus::Pending);
}

#[test]
#[should_panic(expected = "Error(Contract, #22)")]
fn test_player_allowance_check_prior_to_create_match() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    let game_code = String::from_str(&env, "GAME_ALLOWANCE_1");
    // Only approve 50 when wager is 100
    approve(&env, &token, &player1, &contract_id, 50);

    // Should fail with InsufficientAllowance (#22)
    client.create_match(&game_code, &player1, &token.address, &100);
}

#[test]
#[should_panic(expected = "Error(Contract, #22)")]
fn test_player_allowance_check_prior_to_join_match() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    let game_code = String::from_str(&env, "GAME_ALLOWANCE_2");
    approve(&env, &token, &player1, &contract_id, 100);
    client.create_match(&game_code, &player1, &token.address, &100);

    // Player 2 only approves 50 when wager is 100
    approve(&env, &token, &player2, &contract_id, 50);
    client.join_match(&game_code, &player2);
}

#[test]
fn test_multi_match_batch_resolution_for_tournament_escrows() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let player3 = Address::generate(&env);
    let player4 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);
    token_admin_client.mint(&player3, &1000);
    token_admin_client.mint(&player4, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    // Match 1
    let game1 = String::from_str(&env, "TOURN_M1");
    approve(&env, &token, &player1, &contract_id, 100);
    approve(&env, &token, &player2, &contract_id, 100);
    client.create_match(&game1, &player1, &token.address, &100);
    client.join_match(&game1, &player2);

    // Match 2
    let game2 = String::from_str(&env, "TOURN_M2");
    approve(&env, &token, &player3, &contract_id, 100);
    approve(&env, &token, &player4, &contract_id, 100);
    client.create_match(&game2, &player3, &token.address, &100);
    client.join_match(&game2, &player4);

    let mut resolutions = Vec::new(&env);
    resolutions.push_back(MatchResolution {
        match_id: game1.clone(),
        winner: Some(player1.clone()),
        moves_hash: String::from_str(&env, "hash1"),
    });
    resolutions.push_back(MatchResolution {
        match_id: game2.clone(),
        winner: None, // Draw
        moves_hash: String::from_str(&env, "hash2"),
    });

    client.batch_resolve_tournament_matches(&resolutions);

    let m1 = client.get_match(&game1);
    assert_eq!(m1.status, MatchStatus::Resolved);
    assert_eq!(m1.winner, Some(player1));

    let m2 = client.get_match(&game2);
    assert_eq!(m2.status, MatchStatus::Resolved);
    assert_eq!(m2.winner, None);
}

#[test]
#[should_panic(expected = "Error(Contract, #26)")]
fn test_batch_resolve_matches_rejects_empty() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);

    let resolutions = Vec::new(&env);
    client.batch_resolve_matches(&resolutions);
}

#[test]
#[should_panic(expected = "Error(Contract, #26)")]
fn test_batch_resolve_matches_rejects_exceeding_max() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);

    let mut resolutions = Vec::new(&env);
    for _ in 0..11 {
        resolutions.push_back(MatchResolution {
            match_id: String::from_str(&env, "G"),
            winner: None,
            moves_hash: String::from_str(&env, "hash"),
        });
    }
    client.batch_resolve_tournament_matches(&resolutions);
}

// ---------------------------------------------------------------------------
// Circuit Breaker: Emergency Token Drain Safeguard (Issue #142)
// ---------------------------------------------------------------------------

/// Sets up a contract holding a funded (Active) match so there is a real token
/// balance to drain. Returns the client, contract id, token client, coordinator
/// and a separate treasury vault address.
fn setup_funded_escrow<'a>(
    env: &'a Env,
) -> (
    ChessterEscrowClient<'a>,
    Address,
    TokenClient<'a>,
    Address,
    Address,
) {
    let coordinator = Address::generate(env);
    let treasury_vault = Address::generate(env);
    let player1 = Address::generate(env);
    let player2 = Address::generate(env);
    let token_admin = Address::generate(env);

    let (token, token_admin_client) = create_token_contract(env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    let game_code = String::from_str(env, "DRAIN1");
    approve(env, &token, &player1, &contract_id, 1000);
    approve(env, &token, &player2, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);

    // Contract now holds the full 200-unit pool.
    assert_eq!(token.balance(&contract_id), 200);

    (client, contract_id, token, coordinator, treasury_vault)
}

#[test]
fn test_emergency_drain_happy_path() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, contract_id, token, _coordinator, treasury_vault) = setup_funded_escrow(&env);

    client.set_treasury_vault(&treasury_vault);
    client.pause();
    client.authorize_migration();

    assert!(client.is_migration_authorized());

    let drained = client.emergency_drain(&token.address);

    assert_eq!(drained, 200);
    assert_eq!(token.balance(&contract_id), 0);
    assert_eq!(token.balance(&treasury_vault), 200);
    // Authorization is consumed after a successful drain.
    assert!(!client.is_migration_authorized());
}

#[test]
#[should_panic(expected = "Error(Contract, #39)")]
fn test_emergency_drain_blocked_when_not_paused() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _contract_id, token, _coordinator, treasury_vault) = setup_funded_escrow(&env);

    // Configure vault but leave the contract unpaused; the drain must refuse.
    client.set_treasury_vault(&treasury_vault);
    client.emergency_drain(&token.address);
}

#[test]
#[should_panic(expected = "Error(Contract, #40)")]
fn test_emergency_drain_blocked_without_migration_authorization() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _contract_id, token, _coordinator, treasury_vault) = setup_funded_escrow(&env);

    client.set_treasury_vault(&treasury_vault);
    client.pause();
    // Deliberately skip authorize_migration().
    client.emergency_drain(&token.address);
}

#[test]
#[should_panic(expected = "Error(Contract, #41)")]
fn test_emergency_drain_blocked_without_treasury_vault() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _contract_id, token, _coordinator, _treasury_vault) = setup_funded_escrow(&env);

    client.pause();
    client.authorize_migration();
    // No treasury vault configured — there is no safe destination.
    client.emergency_drain(&token.address);
}

#[test]
#[should_panic(expected = "Error(Contract, #39)")]
fn test_authorize_migration_requires_pause_first() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);

    // Cannot arm the migration window while the circuit breaker is disengaged.
    client.authorize_migration();
}

#[test]
fn test_emergency_drain_requires_coordinator_auth() {
    // Exploit simulation: a non-coordinator attempts to sweep the treasury.
    let env = Env::default();

    let coordinator = Address::generate(&env);
    let attacker = Address::generate(&env);
    let treasury_vault = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    // Perform privileged setup as the real coordinator.
    env.mock_all_auths();
    token_admin_client.mint(&contract_id, &500);
    client.init(&coordinator, &500);
    client.set_treasury_vault(&treasury_vault);
    client.pause();
    client.authorize_migration();

    // Now require genuine auth and present only the attacker's authorization.
    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &attacker,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &contract_id,
            fn_name: "emergency_drain",
            args: (&token.address,).into_val(&env),
            sub_invokes: &[],
        },
    }]);

    let result = client.try_emergency_drain(&token.address);
    assert!(result.is_err());
    // Funds remain untouched in the contract.
    assert_eq!(token.balance(&contract_id), 500);
    assert_eq!(token.balance(&treasury_vault), 0);
}

#[test]
fn test_revoke_migration_relocks_drain() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _contract_id, token, _coordinator, treasury_vault) = setup_funded_escrow(&env);

    client.set_treasury_vault(&treasury_vault);
    client.pause();
    client.authorize_migration();
    assert!(client.is_migration_authorized());

    client.revoke_migration();
    assert!(!client.is_migration_authorized());

    let result = client.try_emergency_drain(&token.address);
    assert!(result.is_err());
}

#[test]
fn test_resolve_match_with_signature() {
    let env = Env::default();
    env.mock_all_auths();

    use ed25519_dalek::{Signer, SigningKey};
    use soroban_sdk::xdr::ToXdr;

    let signing_key = SigningKey::from_bytes(&[1u8; 32]);
    let pubkey_bytes = signing_key.verifying_key().to_bytes();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);
    client.set_coordinator_pubkey(&BytesN::from_array(&env, &pubkey_bytes));

    let game_code = String::from_str(&env, "GAME_SIG");
    approve(&env, &token, &player1, &contract_id, 100);
    approve(&env, &token, &player2, &contract_id, 100);
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);

    let payload = MatchResolutionPayload {
        match_id: game_code.clone(),
        winner: Some(player1.clone()),
        moves_hash: String::from_str(&env, "some_hash"),
        nonce: 12345,
    };

    let payload_bytes = payload.clone().to_xdr(&env);
    let mut payload_slice = alloc::vec![0u8; payload_bytes.len() as usize];
    payload_bytes.copy_into_slice(&mut payload_slice);
    let signature = signing_key.sign(&payload_slice);
    let sig_bytes = signature.to_bytes();

    client.resolve_match_with_signature(&payload, &BytesN::from_array(&env, &sig_bytes));

    let m = client.get_match(&game_code);
    assert_eq!(m.status, MatchStatus::Resolved);
    assert_eq!(token.balance(&player1), 1090);
    assert_eq!(token.balance(&player2), 900);
}

#[test]
#[should_panic(expected = "HostError")]
fn test_resolve_match_with_invalid_signature() {
    let env = Env::default();
    env.mock_all_auths();

    use ed25519_dalek::SigningKey;

    let signing_key = SigningKey::from_bytes(&[1u8; 32]);
    let pubkey_bytes = signing_key.verifying_key().to_bytes();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);
    client.set_coordinator_pubkey(&BytesN::from_array(&env, &pubkey_bytes));

    let game_code = String::from_str(&env, "GAME_SIG_BAD");
    approve(&env, &token, &player1, &contract_id, 100);
    approve(&env, &token, &player2, &contract_id, 100);
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);

    let payload = MatchResolutionPayload {
        match_id: game_code.clone(),
        winner: Some(player1.clone()),
        moves_hash: String::from_str(&env, "some_hash"),
        nonce: 12345,
    };

    let bad_sig_bytes = [0u8; 64];
    client.resolve_match_with_signature(&payload, &BytesN::from_array(&env, &bad_sig_bytes));
}

#[test]
fn test_batch_resolve_five_matches() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    let mut resolutions = Vec::new(&env);
    for i in 0..5 {
        let p1 = Address::generate(&env);
        let p2 = Address::generate(&env);
        token_admin_client.mint(&p1, &1000);
        token_admin_client.mint(&p2, &1000);

        let game_code = String::from_str(&env, &alloc::format!("GAME{}", i));
        approve(&env, &token, &p1, &contract_id, 100);
        approve(&env, &token, &p2, &contract_id, 100);
        client.create_match(&game_code, &p1, &token.address, &100);
        client.join_match(&game_code, &p2);

        resolutions.push_back(MatchResolution {
            match_id: game_code,
            winner: Some(p1),
            moves_hash: String::from_str(&env, "hash"),
        });
    }

    client.batch_resolve_matches(&resolutions);

    for i in 0..5 {
        let game_code = String::from_str(&env, &alloc::format!("GAME{}", i));
        let m = client.get_match(&game_code);
        assert_eq!(m.status, MatchStatus::Resolved);
    }
}

#[test]
#[should_panic(expected = "Error(Contract, #43)")]
fn test_resolve_match_with_used_nonce() {
    let env = Env::default();
    env.mock_all_auths();

    use ed25519_dalek::{Signer, SigningKey};
    use soroban_sdk::xdr::ToXdr;

    let signing_key = SigningKey::from_bytes(&[1u8; 32]);
    let pubkey_bytes = signing_key.verifying_key().to_bytes();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);
    client.set_coordinator_pubkey(&BytesN::from_array(&env, &pubkey_bytes));

    let game_code = String::from_str(&env, "GAME_SIG_NONCE");
    approve(&env, &token, &player1, &contract_id, 100);
    approve(&env, &token, &player2, &contract_id, 100);
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);

    let payload = MatchResolutionPayload {
        match_id: game_code.clone(),
        winner: Some(player1.clone()),
        moves_hash: String::from_str(&env, "some_hash"),
        nonce: 12345,
    };

    let payload_bytes = payload.clone().to_xdr(&env);
    let mut payload_slice = alloc::vec![0u8; payload_bytes.len() as usize];
    payload_bytes.copy_into_slice(&mut payload_slice);
    let signature = signing_key.sign(&payload_slice);
    let sig_bytes = signature.to_bytes();

    client.resolve_match_with_signature(&payload, &BytesN::from_array(&env, &sig_bytes));

    // Should panic on second invocation
    client.resolve_match_with_signature(&payload, &BytesN::from_array(&env, &sig_bytes));
}

#[test]
fn test_milestone_events() {
    let env = Env::default();
    env.mock_all_auths();

    use soroban_sdk::TryIntoVal;

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);

    token_admin_client.mint(&player1, &100000);
    token_admin_client.mint(&player2, &100000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    approve(&env, &token, &player1, &contract_id, 100000);
    approve(&env, &token, &player2, &contract_id, 100000);

    let mut streak5_found = false;
    for i in 1..=6 {
        let game_code = String::from_str(&env, &alloc::format!("STREAK_GAME_{}", i));
        client.create_match(&game_code, &player1, &token.address, &100);
        client.join_match(&game_code, &player2);
        client.resolve_match(&game_code, &Some(player1.clone()));

        let events = env.events().all();
        for (_contract_id, topic, payload) in events.into_iter() {
            if topic.len() == 2 {
                let t0: Result<Symbol, _> = topic.get(0).unwrap().try_into_val(&env);
                if let Ok(sym) = t0 {
                    if sym == symbol_short!("milestone") {
                        let p: Address = topic.get(1).unwrap().try_into_val(&env).unwrap();
                        assert_eq!(p, player1);
                        let (streak, m_type): (u32, Symbol) = payload.try_into_val(&env).unwrap();
                        assert_eq!(streak, 5);
                        assert_eq!(m_type, symbol_short!("streak5"));
                        streak5_found = true;
                    }
                }
            }
        }
    }
    assert!(streak5_found, "milestone event for streak 5 not found");
}

#[test]
fn test_player_rating_commitment() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player = Address::generate(&env);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);

    // Initial query should return None
    assert_eq!(client.get_player_rating(&player), None);

    // Commit player rating
    client.commit_player_rating(&player, &1650, &42);

    // Query record and verify contents
    let record = client
        .get_player_rating(&player)
        .expect("record should exist");
    assert_eq!(record.rating, 1650);
    assert_eq!(record.games_played, 42);
    assert_eq!(record.updated_at, env.ledger().timestamp());
    assert_eq!(record.last_updated(), env.ledger().timestamp());

    // Update player rating after more games
    env.ledger().set_timestamp(env.ledger().timestamp() + 3600);
    client.commit_player_rating(&player, &1720, &55);

    let updated = client
        .get_player_rating(&player)
        .expect("updated record should exist");
    assert_eq!(updated.rating, 1720);
    assert_eq!(updated.games_played, 55);
    assert_eq!(updated.updated_at, env.ledger().timestamp());
}

#[test]
fn test_player_rating_unauthorized() {
    let env = Env::default();
    let coordinator = Address::generate(&env);
    let player = Address::generate(&env);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    env.mock_all_auths();
    client.init(&coordinator, &500);

    // Disallow mock auths
    env.set_auths(&[]);
    let res = client.try_commit_player_rating(&player, &1800, &20);
    assert!(
        res.is_err(),
        "Non-coordinator or unauthorized call must fail"
    );
}

#[test]
fn test_player_rating_commitment_with_signature() {
    let env = Env::default();
    env.mock_all_auths();

    use ed25519_dalek::{Signer, SigningKey};
    use soroban_sdk::xdr::ToXdr;

    let signing_key = SigningKey::from_bytes(&[2u8; 32]);
    let pubkey_bytes = signing_key.verifying_key().to_bytes();

    let coordinator = Address::generate(&env);
    let player = Address::generate(&env);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.set_coordinator_pubkey(&BytesN::from_array(&env, &pubkey_bytes));

    let payload = RatingCommitmentPayload {
        player: player.clone(),
        rating: 1950,
        games_played: 120,
    };
    let payload_bytes = payload.to_xdr(&env);
    let mut payload_slice = alloc::vec![0u8; payload_bytes.len() as usize];
    payload_bytes.copy_into_slice(&mut payload_slice);
    let signature = signing_key.sign(&payload_slice);
    let sig_bytes = signature.to_bytes();

    client.commit_player_rating_with_sig(
        &player,
        &1950,
        &120,
        &BytesN::from_array(&env, &sig_bytes),
    );

    let record = client
        .get_player_rating(&player)
        .expect("record should exist");
    assert_eq!(record.rating, 1950);
    assert_eq!(record.games_played, 120);
}

#[test]
#[should_panic(expected = "HostError")]
fn test_player_rating_commitment_with_invalid_signature() {
    let env = Env::default();
    env.mock_all_auths();

    use ed25519_dalek::SigningKey;

    let signing_key = SigningKey::from_bytes(&[3u8; 32]);
    let pubkey_bytes = signing_key.verifying_key().to_bytes();

    let coordinator = Address::generate(&env);
    let player = Address::generate(&env);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.set_coordinator_pubkey(&BytesN::from_array(&env, &pubkey_bytes));

    let bad_sig = [9u8; 64];
    client.commit_player_rating_with_sig(&player, &2100, &300, &BytesN::from_array(&env, &bad_sig));
}

#[test]
fn test_replay_protection() {
    let env = Env::default();
    env.mock_all_auths();

    let player = Address::generate(&env);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    // Initial nonce must be 0
    assert_eq!(client.get_account_nonce(&player), 0);
    assert_eq!(client.get_player_nonce(&player), 0);

    // 1. Valid first execution with nonce = 1 succeeds and increments nonce
    client.increment_player_nonce(&player, &1);
    assert_eq!(client.get_account_nonce(&player), 1);
    assert_eq!(client.get_player_nonce(&player), 1);

    // 2. Valid second execution with nonce = 2 succeeds and increments nonce
    client.increment_player_nonce(&player, &2);
    assert_eq!(client.get_account_nonce(&player), 2);
    assert_eq!(client.get_player_nonce(&player), 2);

    // 3. Test deposit authorization payload verification
    let payload = DepositAuthorizationPayload {
        player: player.clone(),
        game_code: String::from_str(&env, "GAME_DEP"),
        amount: 100,
        nonce: 3,
    };
    client.verify_deposit_authorization(&payload);
    assert_eq!(client.get_account_nonce(&player), 3);
}

#[test]
#[should_panic(expected = "Error(Contract, #43)")]
fn test_replay_protection_rejects_duplicate_nonce() {
    let env = Env::default();
    env.mock_all_auths();

    let player = Address::generate(&env);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    // Nonce 1 executes
    client.increment_player_nonce(&player, &1);
    assert_eq!(client.get_account_nonce(&player), 1);

    // Replay of Nonce 1 must panic with NonceAlreadyUsed (#43)
    client.increment_player_nonce(&player, &1);
}

#[test]
#[should_panic(expected = "Error(Contract, #43)")]
fn test_replay_protection_rejects_out_of_order_nonce() {
    let env = Env::default();
    env.mock_all_auths();

    let player = Address::generate(&env);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    // Skipping from 0 to 5 must fail with NonceAlreadyUsed (#43)
    client.increment_player_nonce(&player, &5);
}

// ---------------------------------------------------------------------------
// Tests for Issue #287: Custom Time-Lock Wager Match Escrows
// ---------------------------------------------------------------------------

#[test]
fn test_custom_match_duration_bullet_vs_classical() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);

    token_admin_client.mint(&player1, &2000);
    token_admin_client.mint(&player2, &2000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    approve(&env, &token, &player1, &contract_id, 2000);
    approve(&env, &token, &player2, &contract_id, 2000);

    // Bullet match with 180s duration
    let bullet_game = String::from_str(&env, "BULLET_180");
    client.create_match_with_duration(&bullet_game, &player1, &token.address, &100, &180);
    client.join_match(&bullet_game, &player2);

    let bullet_data = client.get_match(&bullet_game);
    assert_eq!(bullet_data.max_duration_seconds, 180);
    assert_eq!(bullet_data.status, MatchStatus::Active);

    // Classical match with 3600s duration
    let classical_game = String::from_str(&env, "CLASSICAL_3600");
    client.create_match_with_duration(&classical_game, &player1, &token.address, &100, &3600);
    client.join_match(&classical_game, &player2);

    let classical_data = client.get_match(&classical_game);
    assert_eq!(classical_data.max_duration_seconds, 3600);
    assert_eq!(classical_data.status, MatchStatus::Active);

    // Advance ledger timestamp by 200 seconds (bullet expired, classical still active)
    let current_time = env.ledger().timestamp();
    env.ledger().set_timestamp(current_time + 200);

    // Bullet match can be claimed via abandoned refund
    client.claim_abandoned_refund(&bullet_game);
    let updated_bullet = client.get_match(&bullet_game);
    assert_eq!(updated_bullet.status, MatchStatus::Refunded);

    // Both players received their wagers back for the bullet match
    assert_eq!(token.balance(&player1), 1900); // 100 refunded from bullet, 100 still locked in classical
    assert_eq!(token.balance(&player2), 1900);

    // Advance time past classical timeout (total +3700s)
    env.ledger().set_timestamp(current_time + 3700);
    client.claim_abandoned_refund(&classical_game);
    let updated_classical = client.get_match(&classical_game);
    assert_eq!(updated_classical.status, MatchStatus::Refunded);

    // Both players are fully refunded
    assert_eq!(token.balance(&player1), 2000);
    assert_eq!(token.balance(&player2), 2000);
}

#[test]
#[should_panic(expected = "HostError")]
fn test_custom_match_duration_rejects_below_minimum() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);
    approve(&env, &token, &player1, &contract_id, 1000);

    let game = String::from_str(&env, "TOO_SHORT");
    // 60s is below MIN_MATCH_DURATION_SECS (120s)
    client.create_match_with_duration(&game, &player1, &token.address, &100, &60);
}

#[test]
#[should_panic(expected = "HostError")]
fn test_custom_match_duration_rejects_above_maximum() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);
    approve(&env, &token, &player1, &contract_id, 1000);

    let game = String::from_str(&env, "TOO_LONG");
    // 100_000s is above MAX_MATCH_DURATION_SECS (86400s)
    client.create_match_with_duration(&game, &player1, &token.address, &100, &100_000);
}

// ---------------------------------------------------------------------------
// Tests for Issue #288: Contract State Snapshot Export / Platform Metrics
// ---------------------------------------------------------------------------

#[test]
fn test_platform_metrics_tracking() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &5000);
    token_admin_client.mint(&player2, &5000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500); // 5% fee
    client.add_whitelisted_token(&token.address);

    approve(&env, &token, &player1, &contract_id, 5000);
    approve(&env, &token, &player2, &contract_id, 5000);

    // Initial metrics should be 0
    let initial_metrics = client.get_platform_metrics();
    assert_eq!(initial_metrics.total_matches_created, 0);
    assert_eq!(initial_metrics.active_matches_count, 0);
    assert_eq!(initial_metrics.total_volume_xlm, 0);
    assert_eq!(initial_metrics.total_rake_collected, 0);

    // Match 1: Player 1 creates
    let game1 = String::from_str(&env, "METRICS_GAME_1");
    client.create_match(&game1, &player1, &token.address, &200);

    let m1 = client.get_platform_metrics();
    assert_eq!(m1.total_matches_created, 1);
    assert_eq!(m1.active_matches_count, 1);
    assert_eq!(m1.total_volume_xlm, 200);

    // Player 2 joins Match 1
    client.join_match(&game1, &player2);
    let m2 = client.get_platform_metrics();
    assert_eq!(m2.total_matches_created, 1);
    assert_eq!(m2.active_matches_count, 1);
    assert_eq!(m2.total_volume_xlm, 400);

    // Match 1 resolved with Player 1 winning (400 pool, 5% fee = 20)
    client.resolve_match(&game1, &Some(player1.clone()));
    let m3 = client.get_platform_metrics();
    assert_eq!(m3.total_matches_created, 1);
    assert_eq!(m3.active_matches_count, 0);
    assert_eq!(m3.total_volume_xlm, 400);
    assert_eq!(m3.total_rake_collected, 20);

    // Match 2: Player 1 creates and cancels
    let game2 = String::from_str(&env, "METRICS_GAME_2");
    client.create_match(&game2, &player1, &token.address, &300);
    let m4 = client.get_platform_metrics();
    assert_eq!(m4.total_matches_created, 2);
    assert_eq!(m4.active_matches_count, 1);
    assert_eq!(m4.total_volume_xlm, 700);

    client.cancel_pending_match(&game2, &player1);
    let m5 = client.get_platform_metrics();
    assert_eq!(m5.total_matches_created, 2);
    assert_eq!(m5.active_matches_count, 0);
    assert_eq!(m5.total_volume_xlm, 700);
    assert_eq!(m5.total_rake_collected, 20);
}

// ---------------------------------------------------------------------------
// Tests for Issue #289: Native Stellar Fee Sponsorship & Account Creation
// ---------------------------------------------------------------------------

#[test]
fn test_sponsored_deposit_invocation() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let sponsor = Address::generate(&env);
    let unfunded_player1 = Address::generate(&env);
    let unfunded_player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    // Only sponsor has funds; unfunded players have 0 balance
    token_admin_client.mint(&sponsor, &5000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    approve(&env, &token, &sponsor, &contract_id, 5000);

    let game_code = String::from_str(&env, "SPONSORED_GAME");

    // Sponsor funds deposit to create match on behalf of unfunded Player 1
    client.record_sponsored_deposit(&game_code, &unfunded_player1, &sponsor, &150);

    let match_data = client.get_match(&game_code);
    assert_eq!(match_data.player1, unfunded_player1);
    assert_eq!(match_data.status, MatchStatus::Pending);
    assert_eq!(match_data.wager_amount, 150);
    assert_eq!(token.balance(&contract_id), 150);
    assert_eq!(client.get_player_sponsorship_total(&unfunded_player1), 150);

    // Sponsor funds deposit to join match on behalf of unfunded Player 2
    client.record_sponsored_deposit(&game_code, &unfunded_player2, &sponsor, &150);

    let funded_match = client.get_match(&game_code);
    assert_eq!(funded_match.player2, Some(unfunded_player2.clone()));
    assert_eq!(funded_match.status, MatchStatus::Active);
    assert_eq!(funded_match.total_staked, 300);
    assert_eq!(token.balance(&contract_id), 300);
    assert_eq!(client.get_player_sponsorship_total(&unfunded_player2), 150);
}

// ---------------------------------------------------------------------------
// Tests for Issue #290: Collaborative Multi-Party Match Cancellation Protocol
// ---------------------------------------------------------------------------

#[test]
fn test_resolve_match_pays_winner_minus_fee_and_finalizes_state() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500); // 5% fee
    client.add_whitelisted_token(&token.address);

    let game_code = String::from_str(&env, "CEI1");
    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);

    client.resolve_match(&game_code, &Some(player1.clone()));

    // 200 pot, 5% fee = 10; winner takes 190.
    assert_eq!(token.balance(&player1), 1090);
    assert_eq!(token.balance(&player2), 900);
    assert_eq!(token.balance(&coordinator), 10);
    assert_eq!(token.balance(&contract_id), 0);

    // Effects were applied before the transfers: the match is fully resolved.
    let match_data = client.get_match(&game_code);
    assert_eq!(match_data.status, MatchStatus::Resolved);
    assert_eq!(match_data.winner, Some(player1));
}

#[test]
#[should_panic(expected = "Error(Contract, #7)")]
fn test_resolve_match_cannot_be_replayed_after_settlement() {
    // Exploit: a re-entrant or replayed resolve must not double-spend the pot.
    // Because state is finalized before any transfer, the second resolve sees a
    // non-Active match and aborts with MatchNotActive (#7).
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    let game_code = String::from_str(&env, "CEI2");
    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);

    client.resolve_match(&game_code, &Some(player1.clone()));
    client.resolve_match(&game_code, &Some(player1));
}

#[test]
fn test_collaborative_mutual_cancellation_protocol() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);

    let game_code = String::from_str(&env, "MUTUAL_CANC_1");
    client.create_match(&game_code, &player1, &token.address, &200);
    client.join_match(&game_code, &player2);

    assert_eq!(token.balance(&player1), 800);
    assert_eq!(token.balance(&player2), 800);
    assert_eq!(token.balance(&contract_id), 400);

    // Player 1 proposes mutual cancellation
    client.propose_mutual_cancellation(&game_code, &player1);
    let match_data = client.get_match(&game_code);
    assert_eq!(match_data.cancellation_proposed_by, Some(player1.clone()));

    // Player 2 confirms mutual cancellation
    client.confirm_mutual_cancellation(&game_code, &player2);

    let cancelled_match = client.get_match(&game_code);
    assert_eq!(cancelled_match.status, MatchStatus::Refunded);
    assert_eq!(cancelled_match.cancellation_proposed_by, None);

    // Both players received 100% of their deposits back
    assert_eq!(token.balance(&player1), 1000);
    assert_eq!(token.balance(&player2), 1000);
    assert_eq!(token.balance(&contract_id), 0);
}

#[test]
#[should_panic(expected = "HostError")]
fn test_mutual_cancellation_cannot_confirm_own_proposal() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);

    let game_code = String::from_str(&env, "OWN_PROPOSAL");
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);

    client.propose_mutual_cancellation(&game_code, &player1);
    // Player 1 cannot confirm their own proposal -> panics with CannotConfirmOwnProposal
    client.confirm_mutual_cancellation(&game_code, &player1);
}

#[test]
fn test_withdraw_cancellation_proposal() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);

    let game_code = String::from_str(&env, "WITHDRAW_PROP");
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);

    client.propose_mutual_cancellation(&game_code, &player1);
    assert_eq!(
        client.get_match(&game_code).cancellation_proposed_by,
        Some(player1.clone())
    );

    // Proposer withdraws proposal
    client.withdraw_cancellation_proposal(&game_code, &player1);
    assert_eq!(client.get_match(&game_code).cancellation_proposed_by, None);
}

#[test]
#[should_panic(expected = "HostError")]
fn test_mutual_cancellation_outsider_cannot_confirm() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let outsider = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);

    let game_code = String::from_str(&env, "OUTSIDER_TEST");
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);

    client.propose_mutual_cancellation(&game_code, &player1);
    // Outsider cannot confirm -> panics with UnauthorizedPlayer
    client.confirm_mutual_cancellation(&game_code, &outsider);
}

#[test]
fn test_fee_discount_tiers() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let zero_bal_winner = Address::generate(&env);
    let tier1_winner = Address::generate(&env);
    let tier2_winner = Address::generate(&env);
    let opponent = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    let (gov_token, gov_token_admin_client) = create_token_contract(&env, &token_admin);

    // Fund players with match wagering tokens
    token_admin_client.mint(&zero_bal_winner, &10_000);
    token_admin_client.mint(&tier1_winner, &10_000);
    token_admin_client.mint(&tier2_winner, &10_000);
    token_admin_client.mint(&opponent, &30_000);

    // Fund governance token holdings
    // Tier 1: 1,000 tokens (10_000_000_000 stroops) -> 25% discount off 500 bps = 375 bps
    gov_token_admin_client.mint(&tier1_winner, &10_000_000_000);
    // Tier 2: 5,000 tokens (50_000_000_000 stroops) -> 50% discount off 500 bps = 250 bps
    gov_token_admin_client.mint(&tier2_winner, &50_000_000_000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500); // 5% base fee (500 bps)
    client.add_whitelisted_token(&token.address);
    client.set_gov_token_address(&gov_token.address);

    assert_eq!(client.get_gov_token(), Some(gov_token.address.clone()));

    // 1. Verify calculated effective fee bps
    assert_eq!(client.get_effective_fee_bps(&zero_bal_winner), 500); // 0% discount
    assert_eq!(client.get_effective_fee_bps(&tier1_winner), 375); // 25% discount
    assert_eq!(client.get_effective_fee_bps(&tier2_winner), 250); // 50% discount

    // 2. Verify calculate_discounted_fee view function and strict balance conservation
    let pool: i128 = 200;
    let (net0, fee0) = client.calculate_discounted_fee(&pool, &zero_bal_winner);
    assert_eq!(fee0, 10);
    assert_eq!(net0, 190);
    assert_eq!(net0 + fee0, pool);

    let (net1, fee1) = client.calculate_discounted_fee(&pool, &tier1_winner);
    assert_eq!(fee1, 7); // 200 * 375 / 10000 = 7.5 -> 7
    assert_eq!(net1, 193);
    assert_eq!(net1 + fee1, pool);

    let (net2, fee2) = client.calculate_discounted_fee(&pool, &tier2_winner);
    assert_eq!(fee2, 5); // 200 * 250 / 10000 = 5
    assert_eq!(net2, 195);
    assert_eq!(net2 + fee2, pool);

    // 3. Test resolve_match execution for Tier 1 winner
    approve(&env, &token, &tier1_winner, &contract_id, 100);
    approve(&env, &token, &opponent, &contract_id, 100);

    let game_code_1 = String::from_str(&env, "GAME_TIER1");
    client.create_match(&game_code_1, &tier1_winner, &token.address, &100);
    client.join_match(&game_code_1, &opponent);

    client.resolve_match(&game_code_1, &Some(tier1_winner.clone()));
    assert_eq!(token.balance(&tier1_winner), 10_000 - 100 + 193); // net payout 193
    assert_eq!(token.balance(&coordinator), 7); // fee payout 7

    // 4. Test resolve_match execution for Tier 2 winner
    approve(&env, &token, &tier2_winner, &contract_id, 100);
    approve(&env, &token, &opponent, &contract_id, 100);

    let game_code_2 = String::from_str(&env, "GAME_TIER2");
    client.create_match(&game_code_2, &tier2_winner, &token.address, &100);
    client.join_match(&game_code_2, &opponent);

    client.resolve_match(&game_code_2, &Some(tier2_winner.clone()));
    assert_eq!(token.balance(&tier2_winner), 10_000 - 100 + 195); // net payout 195
    assert_eq!(token.balance(&coordinator), 7 + 5); // additional fee payout 5
}

#[test]
fn test_timelock_safety() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    // Mint funds to contract to simulate trapped escrow funds
    token_admin_client.mint(&contract_id, &50_000);
    assert_eq!(token.balance(&contract_id), 50_000);

    // Initial state: no drain scheduled
    assert_eq!(client.get_emergency_drain_schedule(), None);

    // 1. Coordinator schedules emergency drain
    let current_time = env.ledger().timestamp();
    client.schedule_emergency_drain(&recipient);

    let (sched_recipient, unlock_time) = client.get_emergency_drain_schedule().unwrap();
    assert_eq!(sched_recipient, recipient);
    assert_eq!(unlock_time, current_time + EMERGENCY_DRAIN_TIMELOCK_SECS);

    // 2. Cancellation test: coordinator cancels drain
    client.cancel_emergency_drain();
    assert_eq!(client.get_emergency_drain_schedule(), None);

    // 3. Reschedule drain
    client.schedule_emergency_drain(&recipient);
    let (_, new_unlock_time) = client.get_emergency_drain_schedule().unwrap();

    // 4. Advance time past the 7-day timelock delay (604,800 seconds)
    env.ledger().set_timestamp(new_unlock_time + 10);

    // 5. Execution succeeds after timelock elapses
    client.execute_emergency_drain(&token.address);

    assert_eq!(token.balance(&recipient), 50_000);
    assert_eq!(token.balance(&contract_id), 0);
    assert_eq!(client.get_emergency_drain_schedule(), None);
}

#[test]
#[should_panic(expected = "Error(Contract, #25)")]
fn test_timelock_safety_blocks_premature_drain() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);
    token_admin_client.mint(&contract_id, &50_000);

    client.schedule_emergency_drain(&recipient);

    // Attempting execution immediately or before 7 days (e.g. 6 days) must fail with DisputeTimeLockActive (#25)
    env.ledger()
        .set_timestamp(env.ledger().timestamp() + (6 * 24 * 60 * 60));
    client.execute_emergency_drain(&token.address);
}

#[test]
#[should_panic(expected = "Error(Contract, #24)")]
fn test_timelock_safety_blocks_unscheduled_drain() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, _) = create_token_contract(&env, &token_admin);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);

    // Executing drain without active schedule fails with DisputeNotFound (#24)
    client.execute_emergency_drain(&token.address);
}
