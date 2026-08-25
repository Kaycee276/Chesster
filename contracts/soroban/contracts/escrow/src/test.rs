#![cfg(test)]

use super::*;
use soroban_sdk::token::Client as TokenClient;
use soroban_sdk::token::StellarAssetClient as TokenAdminClient;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
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

#[test]
fn test_ttl_auto_extension_on_state_access() {
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

    approve(&env, &token, &player1, &contract_id, 1000);

    let game_code = String::from_str(&env, "GAME_TTL");
    // Created at sequence 0: the write-path bump extends the entry well past
    // the default ~4096 ledger lifespan.
    client.create_match(&game_code, &player1, &token.address, &100);

    // Fast-forward close to expiry so the remaining TTL drops below the
    // auto-extension threshold, then access state: read-path bump must extend it.
    env.ledger().with_mut(|li| {
        li.sequence_number = 450_000;
    });
    let m = client.get_match(&game_code);
    assert_eq!(m.wager_amount, 100);

    // Jump past the original extended lifespan (~518_400 ledgers). The entry is
    // only still live because the access above re-extended its TTL.
    env.ledger().with_mut(|li| {
        li.sequence_number = 700_000;
    });
    let m = client.get_match(&game_code);
    assert_eq!(m.status, MatchStatus::Pending);
}

#[test]
#[should_panic(expected = "HostError")]
fn test_unmanaged_entry_expires() {
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

    approve(&env, &token, &player1, &contract_id, 1000);

    let game_code = String::from_str(&env, "GAME_TTL");
    client.create_match(&game_code, &player1, &token.address, &100);

    // Without any further access the entry eventually expires and is archived.
    env.ledger().with_mut(|li| {
        li.sequence_number = 600_000;
    });
    client.get_match(&game_code);
}

#[test]
#[should_panic(expected = "Error(Contract, #12)")]
fn test_insufficient_balance_reverts() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &50); // Less than the wager

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);

    let game_code = String::from_str(&env, "GAME_FUNDS");
    client.create_match(&game_code, &player1, &token.address, &100);
}

#[test]
#[should_panic(expected = "Error(Contract, #18)")]
fn test_insufficient_allowance_reverts() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &1000); // Enough balance...

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);

    // ...but no allowance granted to the escrow contract.
    let game_code = String::from_str(&env, "GAME_ALLOW");
    client.create_match(&game_code, &player1, &token.address, &100);
}

#[test]
fn test_raise_dispute_locks_funds() {
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

    let game_code = String::from_str(&env, "GAME_DISPUTE");
    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);

    client.raise_dispute(&game_code, &player1);

    let dispute = client.get_dispute(&game_code);
    assert_eq!(dispute.game_code, game_code);
    assert_eq!(dispute.raised_by, player1);
    assert_eq!(dispute.created_at, 0);
    assert_eq!(dispute.release_at, 172_800); // created_at + 48h
    assert_eq!(dispute.status, DisputeStatus::Locked);

    // Funds stay locked in escrow while disputed.
    assert_eq!(client.get_match(&game_code).status, MatchStatus::Active);
    assert_eq!(token.balance(&contract_id), 200);
}

#[test]
#[should_panic(expected = "Error(Contract, #21)")]
fn test_resolve_match_blocked_during_dispute() {
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

    let game_code = String::from_str(&env, "GAME_DISPUTE");
    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);
    client.raise_dispute(&game_code, &player2);

    // Coordinator cannot settle while the time-lock queue holds the funds.
    client.resolve_match(&game_code, &Some(player1.clone()));
}

#[test]
#[should_panic(expected = "Error(Contract, #21)")]
fn test_timeout_refund_blocked_during_dispute() {
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

    let game_code = String::from_str(&env, "GAME_DISPUTE");
    env.ledger().with_mut(|li| {
        li.timestamp = 1000;
    });

    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);
    client.raise_dispute(&game_code, &player1);

    // Past the 1h timeout but still inside the 48h dispute time-lock.
    env.ledger().with_mut(|li| {
        li.timestamp = 10_000;
    });
    client.refund_after_timeout(&game_code);
}

#[test]
#[should_panic(expected = "Error(Contract, #21)")]
fn test_resolve_dispute_before_lock_expiry_fails() {
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

    let game_code = String::from_str(&env, "GAME_DISPUTE");
    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);
    client.raise_dispute(&game_code, &player1);

    // Arbitration before the 48h time-lock expires is rejected.
    env.ledger().with_mut(|li| {
        li.timestamp = 172_799;
    });
    client.resolve_dispute(&game_code, &Some(player1.clone()));
}

#[test]
fn test_resolve_dispute_after_lock_pays_winner() {
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

    let game_code = String::from_str(&env, "GAME_DISPUTE");
    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);
    client.raise_dispute(&game_code, &player1);

    // Once the time-lock expires the coordinator arbitrates manually.
    env.ledger().with_mut(|li| {
        li.timestamp = 172_800;
    });
    client.resolve_dispute(&game_code, &Some(player1.clone()));

    // Total staked = 200, fee = 5% = 10, winner payout = 190.
    assert_eq!(token.balance(&player1), 1090);
    assert_eq!(token.balance(&player2), 900);
    assert_eq!(token.balance(&coordinator), 10);
    assert_eq!(token.balance(&contract_id), 0);

    let m = client.get_match(&game_code);
    assert_eq!(m.status, MatchStatus::Resolved);
    assert_eq!(m.winner, Some(player1.clone()));

    let dispute = client.get_dispute(&game_code);
    assert_eq!(dispute.status, DisputeStatus::Settled);
}

#[test]
fn test_resolve_dispute_draw_refunds() {
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

    let game_code = String::from_str(&env, "GAME_DISPUTE");
    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);
    client.raise_dispute(&game_code, &player2);

    env.ledger().with_mut(|li| {
        li.timestamp = 200_000;
    });
    client.resolve_dispute(&game_code, &None);

    assert_eq!(token.balance(&player1), 1000);
    assert_eq!(token.balance(&player2), 1000);
    assert_eq!(token.balance(&contract_id), 0);
    assert_eq!(client.get_match(&game_code).status, MatchStatus::Resolved);
}

#[test]
#[should_panic(expected = "Error(Contract, #19)")]
fn test_double_dispute_fails() {
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

    let game_code = String::from_str(&env, "GAME_DISPUTE");
    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);
    client.raise_dispute(&game_code, &player1);
    client.raise_dispute(&game_code, &player2);
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")]
fn test_non_participant_dispute_fails() {
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

    let game_code = String::from_str(&env, "GAME_DISPUTE");
    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);
    client.raise_dispute(&game_code, &outsider);
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")]
fn test_resolve_dispute_invalid_winner_fails() {
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

    let game_code = String::from_str(&env, "GAME_DISPUTE");
    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);
    client.raise_dispute(&game_code, &player1);

    env.ledger().with_mut(|li| {
        li.timestamp = 172_800;
    });
    client.resolve_dispute(&game_code, &Some(outsider.clone()));
}

#[test]
fn test_batch_resolve_matches() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let player3 = Address::generate(&env);
    let player4 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &10000);
    token_admin_client.mint(&player2, &1000);
    token_admin_client.mint(&player3, &1000);
    token_admin_client.mint(&player4, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);

    approve(&env, &token, &player1, &contract_id, 10000);
    approve(&env, &token, &player2, &contract_id, 1000);
    approve(&env, &token, &player3, &contract_id, 1000);
    approve(&env, &token, &player4, &contract_id, 1000);

    let g1 = String::from_str(&env, "TOUR_G1");
    let g2 = String::from_str(&env, "TOUR_G2");
    let g3 = String::from_str(&env, "TOUR_G3");
    client.create_match(&g1, &player1, &token.address, &100);
    client.create_match(&g2, &player1, &token.address, &100);
    client.create_match(&g3, &player1, &token.address, &100);
    client.join_match(&g1, &player2);
    client.join_match(&g2, &player3);
    client.join_match(&g3, &player4);

    let resolutions = vec![
        &env,
        BatchResolution {
            game_code: g1.clone(),
            winner: Some(player2.clone()),
        },
        BatchResolution {
            game_code: g2.clone(),
            winner: None,
        },
        BatchResolution {
            game_code: g3.clone(),
            winner: Some(player4.clone()),
        },
    ];
    client.batch_resolve_matches(&resolutions);

    assert_eq!(client.get_match(&g1).status, MatchStatus::Resolved);
    assert_eq!(client.get_match(&g2).status, MatchStatus::Resolved);
    assert_eq!(client.get_match(&g3).status, MatchStatus::Resolved);

    // g1: player2 wins 190 (5% fee on 200). g2: draw refund. g3: player4 wins 190.
    assert_eq!(token.balance(&player1), 9800); // 9700 staked + 100 draw refund
    assert_eq!(token.balance(&player2), 1090);
    assert_eq!(token.balance(&player3), 1000);
    assert_eq!(token.balance(&player4), 1090);
    assert_eq!(token.balance(&coordinator), 20);
    assert_eq!(token.balance(&contract_id), 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #22)")]
fn test_batch_size_over_limit_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (_token, _token_admin_client) = create_token_contract(&env, &token_admin);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);

    let mut resolutions = Vec::new(&env);
    for _ in 0..11 {
        resolutions.push_back(BatchResolution {
            game_code: String::from_str(&env, "GAME_BATCH"),
            winner: None,
        });
    }
    client.batch_resolve_matches(&resolutions);
}

#[test]
#[should_panic(expected = "Error(Contract, #22)")]
fn test_batch_empty_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (_token, _token_admin_client) = create_token_contract(&env, &token_admin);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);

    let resolutions: Vec<BatchResolution> = Vec::new(&env);
    client.batch_resolve_matches(&resolutions);
}

#[test]
#[should_panic(expected = "Error(Contract, #7)")]
fn test_batch_duplicate_codes_fail_atomically() {
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

    let game_code = String::from_str(&env, "GAME_DUP");
    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);

    // Duplicate entries make the second settlement fail and revert everything.
    let resolutions = vec![
        &env,
        BatchResolution {
            game_code: game_code.clone(),
            winner: Some(player1.clone()),
        },
        BatchResolution {
            game_code: game_code.clone(),
            winner: Some(player1),
        },
    ];
    client.batch_resolve_matches(&resolutions);
}

#[test]
fn test_batch_reverts_entirely_on_invalid_winner() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    let player3 = Address::generate(&env);
    let outsider = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token, token_admin_client) = create_token_contract(&env, &token_admin);
    token_admin_client.mint(&player1, &10000);
    token_admin_client.mint(&player2, &1000);
    token_admin_client.mint(&player3, &1000);

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    client.init(&coordinator, &500);

    let g1 = String::from_str(&env, "ATOM_G1");
    let g2 = String::from_str(&env, "ATOM_G2");
    approve(&env, &token, &player1, &contract_id, 10000);
    approve(&env, &token, &player2, &contract_id, 1000);
    approve(&env, &token, &player3, &contract_id, 1000);
    client.create_match(&g1, &player1, &token.address, &100);
    client.create_match(&g2, &player1, &token.address, &100);
    client.join_match(&g1, &player2);
    client.join_match(&g2, &player3);

    let resolutions = vec![
        &env,
        BatchResolution {
            game_code: g1.clone(),
            winner: Some(player2.clone()),
        },
        BatchResolution {
            game_code: g2,
            winner: Some(outsider),
        },
    ];
    let result = client.try_batch_resolve_matches(&resolutions);
    assert!(result.is_err());

    // Atomicity: nothing from the batch was applied.
    assert_eq!(client.get_match(&g1).status, MatchStatus::Active);
    assert_eq!(token.balance(&player1), 9800);
    assert_eq!(token.balance(&player2), 900);
    assert_eq!(token.balance(&coordinator), 0);
    assert_eq!(token.balance(&contract_id), 400);
}

#[test]
#[should_panic(expected = "Error(Contract, #21)")]
fn test_batch_blocked_by_dispute() {
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

    let game_code = String::from_str(&env, "BATCH_DISPUTE");
    approve(&env, &token, &player1, &contract_id, 1000);
    approve(&env, &token, &player2, &contract_id, 1000);
    client.create_match(&game_code, &player1, &token.address, &100);
    client.join_match(&game_code, &player2);
    client.raise_dispute(&game_code, &player1);

    let resolutions = vec![
        &env,
        BatchResolution {
            game_code,
            winner: Some(player1),
        },
    ];
    client.batch_resolve_matches(&resolutions);
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
