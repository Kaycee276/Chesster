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

    let (_token, _token_admin_client) = create_token_contract(&env, &token_admin);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);

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

    let tournament_id = String::from_str(&env, "TOURNAMENT1");
    let prize_dist = vec![&env, 150, 50];

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

    let tournament_id = String::from_str(&env, "TOURNAMENT1");
    let prize_dist = vec![&env, 150, 50];

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

    client.create_match(&game_code, &player1, &token.address, &100);
    let events_after_create = env.events().all();
    assert!(events_after_create
        .iter()
        .any(|(id, _, _)| id == &contract_id));

    client.join_match(&game_code, &player2);
    let events_after_join_len = env.events().all().len();
    assert!(events_after_join_len > events_after_create.len());

    client.resolve_match(&game_code, &Some(player1.clone()));
    let events_after_resolve_len = env.events().all().len();
    assert!(events_after_resolve_len > events_after_join_len);
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
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);

    let events_before = env.events().all().len();
    client.forfeit_match(&game_code, &player1);
    let events_after = env.events().all().len();

    assert!(events_after > events_before);
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

    env.ledger().with_mut(|li| {
        li.timestamp = 1000;
    });
    client.create_match(&game_code, &player1, &token.address, &100);

    env.ledger().with_mut(|li| {
        li.timestamp = 4601;
    });

    let events_before = env.events().all().len();
    client.refund_after_timeout(&game_code);
    let events_after = env.events().all().len();

    assert!(events_after > events_before);
}
