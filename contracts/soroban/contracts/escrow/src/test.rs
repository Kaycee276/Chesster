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

    let guardians = vec![&env, guardian1.clone(), guardian2.clone(), guardian3.clone()];
    client.set_guardians(&guardians, &2);
    assert_eq!(client.get_guardians(), guardians);
    assert_eq!(client.get_admin_threshold(), 2);

    let proposal_id: u64 = 7;
    let payload_hash = BytesN::from_array(&env, &[11u8; 32]);
    assert!(client.try_propose_admin_action(&outsider, &proposal_id, &payload_hash).is_err());

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
    assert!(client.try_confirm_admin_action(&guardian2, &proposal_id).is_err());
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
    use rand::rngs::OsRng;
    use soroban_sdk::xdr::ToXdr;

    let mut csprng = OsRng;
    let signing_key = SigningKey::generate(&mut csprng);
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
    let signature = signing_key.sign(payload_bytes.to_alloc_vec().as_slice());
    let sig_bytes = signature.to_bytes();

    client.resolve_match_with_signature(&payload, &BytesN::from_array(&env, &sig_bytes));

    let m = client.get_match(&game_code);
    assert_eq!(m.status, MatchStatus::Resolved);
    assert_eq!(token.balance(&player1), 1095);
    assert_eq!(token.balance(&player2), 900);
}

#[test]
#[should_panic(expected = "HostError")]
fn test_resolve_match_with_invalid_signature() {
    let env = Env::default();
    env.mock_all_auths();

    use ed25519_dalek::SigningKey;
    use rand::rngs::OsRng;

    let mut csprng = OsRng;
    let signing_key = SigningKey::generate(&mut csprng);
    let pubkey_bytes = signing_key.verifying_key().to_bytes();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000);
    token_admin_client.mint(&player2, &1000);

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
    use rand::rngs::OsRng;
    use soroban_sdk::xdr::ToXdr;

    let mut csprng = OsRng;
    let signing_key = SigningKey::generate(&mut csprng);
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
    let signature = signing_key.sign(payload_bytes.to_alloc_vec().as_slice());
    let sig_bytes = signature.to_bytes();

    client.resolve_match_with_signature(&payload, &BytesN::from_array(&env, &sig_bytes));

    // Should panic on second invocation
    client.resolve_match_with_signature(&payload, &BytesN::from_array(&env, &sig_bytes));

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
