//! Tests for `resolve_tournament_payout`: atomic multi-recipient tournament settlement.
#![cfg(test)]

use crate::{ChessterEscrow, ChessterEscrowClient, EscrowError, EscrowErrorExt, PayoutRecipient};
use soroban_sdk::token::{Client as TokenClient, StellarAssetClient as TokenAdminClient};
use soroban_sdk::{testutils::Address as _, vec, Address, Env, String, Vec};

struct Fixture<'a> {
    env: Env,
    client: ChessterEscrowClient<'a>,
    coordinator: Address,
    token: TokenClient<'a>,
    players: Vec<Address>,
}

/// Builds a tournament with `n` players paying `buy_in` each, so the pool is
/// genuinely locked in the contract, with the tournament fee set to `fee_bps`.
fn setup<'a>(n: u32, buy_in: i128, fee_bps: u32) -> Fixture<'a> {
    let env = Env::default();
    env.mock_all_auths();
    let coordinator = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(token_admin);
    let token = TokenClient::new(&env, &sac.address());
    let token_admin_client = TokenAdminClient::new(&env, &sac.address());

    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);
    client.init(&coordinator, &500);
    client.set_tournament_fee_bps(&fee_bps);
    client.add_supported_token(&token.address);

    let tournament_id = String::from_str(&env, "T1");
    client.create_tournament(&tournament_id, &buy_in, &32, &2, &0, &token.address);

    let mut players = Vec::new(&env);
    for _ in 0..n {
        let p = Address::generate(&env);
        token_admin_client.mint(&p, &buy_in);
        token.approve(&p, &contract_id, &buy_in, &1_000);
        client.join_tournament(&tournament_id, &p);
        players.push_back(p);
    }

    Fixture {
        env,
        client,
        coordinator,
        token,
        players,
    }
}

fn r(f: &Fixture, idx: u32, bps: u32) -> PayoutRecipient {
    PayoutRecipient {
        recipient: f.players.get(idx).unwrap(),
        bps,
    }
}

#[test]
fn two_player_payout_with_fee() {
    // pool 200, fee 5% (500 bps) => 10 fee; 70% + 25% to players
    let f = setup(2, 100, 500);
    let recipients = vec![&f.env, r(&f, 0, 7_000), r(&f, 1, 2_500)];
    f.client
        .resolve_tournament_payout(&f.coordinator, &1, &f.token.address, &200, &recipients);
    assert_eq!(f.token.balance(&f.players.get(0).unwrap()), 140);
    assert_eq!(f.token.balance(&f.players.get(1).unwrap()), 50);
    assert_eq!(f.token.balance(&f.coordinator), 10);
    assert_eq!(f.token.balance(&f.client.address), 0);
    assert_eq!(f.client.get_escrowed_balance(&f.token.address), 0);
}

#[test]
fn three_player_podium_60_25_10_with_5_percent_fee() {
    let f = setup(3, 1_000, 500);
    let recipients = vec![&f.env, r(&f, 0, 6_000), r(&f, 1, 2_500), r(&f, 2, 1_000)];
    f.client
        .resolve_tournament_payout(&f.coordinator, &7, &f.token.address, &3_000, &recipients);
    assert_eq!(f.token.balance(&f.players.get(0).unwrap()), 1_800);
    assert_eq!(f.token.balance(&f.players.get(1).unwrap()), 750);
    assert_eq!(f.token.balance(&f.players.get(2).unwrap()), 300);
    assert_eq!(f.token.balance(&f.coordinator), 150);
    assert_eq!(f.token.balance(&f.client.address), 0);
}

#[test]
fn odd_amount_rounding_remainder_goes_to_first_place() {
    // pool = 7 * 143 = 1_001; shares floor to 600 / 250 / 100, fee 50.
    // The 1 token remainder is attributed to 1st place.
    let f = setup(7, 143, 500);
    let recipients = vec![&f.env, r(&f, 0, 6_000), r(&f, 1, 2_500), r(&f, 2, 1_000)];
    f.client
        .resolve_tournament_payout(&f.coordinator, &9, &f.token.address, &1_001, &recipients);
    let first = f.token.balance(&f.players.get(0).unwrap());
    let second = f.token.balance(&f.players.get(1).unwrap());
    let third = f.token.balance(&f.players.get(2).unwrap());
    let fee = f.token.balance(&f.coordinator);
    assert_eq!(first, 601);
    assert_eq!(second, 250);
    assert_eq!(third, 100);
    assert_eq!(fee, 50);
    assert_eq!(first + second + third + fee, 1_001);
    assert_eq!(f.token.balance(&f.client.address), 0);
}

#[test]
fn zero_fee_tournament_distributes_everything_to_players() {
    let f = setup(2, 50, 0);
    let recipients = vec![&f.env, r(&f, 0, 6_667), r(&f, 1, 3_333)];
    f.client
        .resolve_tournament_payout(&f.coordinator, &2, &f.token.address, &100, &recipients);
    assert_eq!(f.token.balance(&f.players.get(0).unwrap()), 67);
    assert_eq!(f.token.balance(&f.players.get(1).unwrap()), 33);
    assert_eq!(f.token.balance(&f.client.address), 0);
}

#[test]
fn rejects_distribution_not_summing_to_10000() {
    let f = setup(2, 100, 500);
    // 7000 + 3000 + 500 fee = 10_500
    let over = vec![&f.env, r(&f, 0, 7_000), r(&f, 1, 3_000)];
    let res = f
        .client
        .try_resolve_tournament_payout(&f.coordinator, &1, &f.token.address, &200, &over);
    assert_eq!(
        res.err().unwrap().unwrap(),
        EscrowErrorExt::InvalidPayoutDistribution.into()
    );
    // Under-allocated: 5000 + 500 fee
    let under = vec![&f.env, r(&f, 0, 5_000)];
    let res = f
        .client
        .try_resolve_tournament_payout(&f.coordinator, &1, &f.token.address, &200, &under);
    assert!(res.is_err());
    assert_eq!(f.token.balance(&f.client.address), 200);
}

#[test]
fn rejects_empty_duplicate_and_zero_weight_recipients() {
    let f = setup(2, 100, 500);
    let empty: Vec<PayoutRecipient> = Vec::new(&f.env);
    assert!(f
        .client
        .try_resolve_tournament_payout(&f.coordinator, &1, &f.token.address, &200, &empty)
        .is_err());

    let dup = vec![&f.env, r(&f, 0, 5_000), r(&f, 0, 4_500)];
    assert!(f
        .client
        .try_resolve_tournament_payout(&f.coordinator, &1, &f.token.address, &200, &dup)
        .is_err());

    let zero = vec![&f.env, r(&f, 0, 9_500), r(&f, 1, 0)];
    assert!(f
        .client
        .try_resolve_tournament_payout(&f.coordinator, &1, &f.token.address, &200, &zero)
        .is_err());
}

#[test]
fn rejects_non_coordinator_caller() {
    let f = setup(2, 100, 500);
    let impostor = Address::generate(&f.env);
    let recipients = vec![&f.env, r(&f, 0, 9_500)];
    let res = f
        .client
        .try_resolve_tournament_payout(&impostor, &1, &f.token.address, &200, &recipients);
    assert_eq!(res.err().unwrap().unwrap(), EscrowError::Unauthorized.into());
}

#[test]
fn rejects_pool_larger_than_escrowed_balance() {
    let f = setup(2, 100, 500);
    let recipients = vec![&f.env, r(&f, 0, 9_500)];
    let res = f
        .client
        .try_resolve_tournament_payout(&f.coordinator, &1, &f.token.address, &201, &recipients);
    assert_eq!(
        res.err().unwrap().unwrap(),
        EscrowError::InsufficientFunds.into()
    );
}

#[test]
fn rejects_non_positive_pool() {
    let f = setup(2, 100, 500);
    let recipients = vec![&f.env, r(&f, 0, 9_500)];
    assert!(f
        .client
        .try_resolve_tournament_payout(&f.coordinator, &1, &f.token.address, &0, &recipients)
        .is_err());
    assert!(f
        .client
        .try_resolve_tournament_payout(&f.coordinator, &1, &f.token.address, &-5, &recipients)
        .is_err());
}

#[test]
fn same_tournament_id_cannot_be_paid_twice() {
    let f = setup(2, 100, 500);
    let recipients = vec![&f.env, r(&f, 0, 9_500)];
    f.client
        .resolve_tournament_payout(&f.coordinator, &5, &f.token.address, &100, &recipients);
    let res = f
        .client
        .try_resolve_tournament_payout(&f.coordinator, &5, &f.token.address, &100, &recipients);
    assert_eq!(
        res.err().unwrap().unwrap(),
        EscrowErrorExt::TournamentPayoutAlreadyResolved.into()
    );
    // A different id is independent and consumes the remaining 100.
    f.client
        .resolve_tournament_payout(&f.coordinator, &6, &f.token.address, &100, &recipients);
    assert_eq!(f.token.balance(&f.client.address), 0);
}

#[test]
fn fee_goes_to_treasury_vault_when_configured() {
    let f = setup(2, 100, 500);
    let vault = Address::generate(&f.env);
    f.client.set_treasury_vault(&vault);
    let recipients = vec![&f.env, r(&f, 0, 9_500)];
    f.client
        .resolve_tournament_payout(&f.coordinator, &1, &f.token.address, &200, &recipients);
    assert_eq!(f.token.balance(&vault), 10);
    assert_eq!(f.token.balance(&f.players.get(0).unwrap()), 190);
    assert_eq!(f.token.balance(&f.coordinator), 0);
}
