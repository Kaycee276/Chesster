#![cfg(test)]

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
    let prize_dist = vec![&env, 150, 50];

    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    client.create_tournament(&tournament_id, &100, &prize_dist, &token.address);

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
    client.add_supported_token(&token.address);

    let tournament_id = String::from_str(&env, "TOURNAMENT1");
    let prize_dist = vec![&env, 150, 50];

    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    client.create_tournament(&tournament_id, &100, &prize_dist, &token.address);
    client.join_tournament(&tournament_id, &player1);
    client.join_tournament(&tournament_id, &player2);

    let final_rankings = vec![&env, player1.clone(), player2.clone()];
    client.complete_tournament(&tournament_id, &final_rankings);

    let tournament = client.get_tournament(&tournament_id);
    assert_eq!(tournament.status, TournamentStatus::Completed);
    assert_eq!(token.balance(&player1), 1050);
    assert_eq!(token.balance(&player2), 950);
}

// ---------------------------------------------------------------------------
// Issue #40 — Multi-Token Whitelist Registry
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
// Issue #39 — Match Forfeit Resolution Trigger for Disconnects
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
    // Player 2 never joined — match is still Pending, not Active.

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
// Issue #24 — Typed Soroban Contract Events on Escrow State Transitions
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

// ---------------------------------------------------------------------------
// Issue #23 — Dynamic Wager Scaling with Configurable Minimum & Maximum Limits
// ---------------------------------------------------------------------------

#[test]
fn test_default_wager_limits() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);

    let limits = client.get_wager_limits();
    assert_eq!(limits.min_wager, 1);
    assert_eq!(limits.max_wager, i128::MAX);
    assert_eq!(client.get_min_wager(), 1);
    assert_eq!(client.get_max_wager(), i128::MAX);
}

#[test]
fn test_set_and_get_global_wager_limits() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);

    // Set custom global limits
    client.set_wager_limits(&100, &5000);
    let limits = client.get_wager_limits();
    assert_eq!(limits.min_wager, 100);
    assert_eq!(limits.max_wager, 5000);
    assert_eq!(client.get_min_wager(), 100);
    assert_eq!(client.get_max_wager(), 5000);

    // Set individual min and max
    client.set_min_wager(&200);
    assert_eq!(client.get_min_wager(), 200);
    assert_eq!(client.get_max_wager(), 5000);

    client.set_max_wager(&8000);
    assert_eq!(client.get_min_wager(), 200);
    assert_eq!(client.get_max_wager(), 8000);
}

#[test]
#[should_panic(expected = "HostError")]
fn test_set_wager_limits_zero_or_negative_min_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.set_wager_limits(&0, &1000);
}

#[test]
#[should_panic(expected = "HostError")]
fn test_set_wager_limits_max_smaller_than_min_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.set_wager_limits(&1000, &500);
}

#[test]
fn test_create_match_enforces_wager_limits() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &10000);
    token_admin_client.mint(&player2, &10000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token.address);

    client.set_wager_limits(&100, &1000);

    approve(&env, &token, &player1, &contract_id, 10000);
    approve(&env, &token, &player2, &contract_id, 10000);

    // Exact min wager: 100 succeeds
    let g1 = String::from_str(&env, "GAME_MIN");
    client.create_match(&g1, &player1, &token.address, &100);
    assert_eq!(client.get_match(&g1).wager_amount, 100);

    // Mid-range wager: 500 succeeds
    let g2 = String::from_str(&env, "GAME_MID");
    client.create_match(&g2, &player1, &token.address, &500);
    assert_eq!(client.get_match(&g2).wager_amount, 500);

    // Exact max wager: 1000 succeeds
    let g3 = String::from_str(&env, "GAME_MAX");
    client.create_match(&g3, &player1, &token.address, &1000);
    assert_eq!(client.get_match(&g3).wager_amount, 1000);
}

#[test]
#[should_panic(expected = "HostError")]
fn test_create_match_wager_below_minimum_fails() {
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
    client.set_wager_limits(&100, &1000);

    approve(&env, &token, &player1, &contract_id, 10000);

    let game_code = String::from_str(&env, "GAME_UNDER_MIN");
    client.create_match(&game_code, &player1, &token.address, &99);
}

#[test]
#[should_panic(expected = "HostError")]
fn test_create_match_wager_above_maximum_fails() {
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
    client.set_wager_limits(&100, &1000);

    approve(&env, &token, &player1, &contract_id, 10000);

    let game_code = String::from_str(&env, "GAME_OVER_MAX");
    client.create_match(&game_code, &player1, &token.address, &1001);
}

#[test]
fn test_set_and_get_token_wager_limits() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token1, token1_admin_client) = create_token_contract(&env, &token_admin);
    let (token2, token2_admin_client) = create_token_contract(&env, &token_admin);

    token1_admin_client.mint(&player1, &10000);
    token2_admin_client.mint(&player1, &10000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token1.address);
    client.add_whitelisted_token(&token2.address);

    // Global limits: 100 to 1000
    client.set_wager_limits(&100, &1000);

    // Token1 specific limits: 50 to 500
    client.set_token_wager_limits(&token1.address, &50, &500);

    assert_eq!(client.get_token_min_wager(&token1.address), 50);
    assert_eq!(client.get_token_max_wager(&token1.address), 500);

    // Token2 has no specific limits, falls back to global (100 to 1000)
    assert_eq!(client.get_token_min_wager(&token2.address), 100);
    assert_eq!(client.get_token_max_wager(&token2.address), 1000);

    approve(&env, &token1, &player1, &contract_id, 10000);
    approve(&env, &token2, &player1, &contract_id, 10000);

    // Token1: 75 succeeds (between 50 and 500)
    let g1 = String::from_str(&env, "GAME_TOK1_OK");
    client.create_match(&g1, &player1, &token1.address, &75);

    // Token2: 75 fails because global min is 100
    let g2 = String::from_str(&env, "GAME_TOK2_FAIL");
    let res = client.try_create_match(&g2, &player1, &token2.address, &75);
    assert!(res.is_err());

    // Remove token1 limits -> token1 now falls back to global (100 to 1000)
    client.remove_token_wager_limits(&token1.address);
    assert_eq!(client.get_token_min_wager(&token1.address), 100);
    assert_eq!(client.get_token_max_wager(&token1.address), 1000);
}

#[test]
fn test_dynamic_wager_scaling() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token, _admin_client) = create_token_contract(&env, &token_admin);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.set_wager_limits(&100, &1000);

    // Scale up by 1.5x (15,000 bps)
    client.scale_wager_limits(&15_000);
    assert_eq!(client.get_min_wager(), 150);
    assert_eq!(client.get_max_wager(), 1500);

    // Scale down by 50% (5,000 bps)
    client.scale_wager_limits(&5_000);
    assert_eq!(client.get_min_wager(), 75);
    assert_eq!(client.get_max_wager(), 750);

    // Dynamic scaling for token-specific limits
    client.set_token_wager_limits(&token.address, &200, &2000);
    client.scale_token_wager_limits(&token.address, &20_000); // 2x
    assert_eq!(client.get_token_min_wager(&token.address), 400);
    assert_eq!(client.get_token_max_wager(&token.address), 4000);
}

#[test]
fn test_native_match_enforces_wager_limits() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (native_token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &10000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);
    client.set_native_xlm_address(&native_token.address);
    client.set_wager_limits(&100, &1000);

    approve(&env, &native_token, &player1, &contract_id, 10000);

    // Native match below min fails
    let g1 = String::from_str(&env, "NATIVE_BELOW_MIN");
    let res = client.try_create_native_match(&g1, &player1, &50);
    assert!(res.is_err());

    // Native match within limits succeeds
    let g2 = String::from_str(&env, "NATIVE_WITHIN_LIMITS");
    client.create_native_match(&g2, &player1, &500);
    let match_data = client.get_match(&g2);
    assert_eq!(match_data.wager_amount, 500);
}
