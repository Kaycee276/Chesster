#![cfg(test)]

use super::{ChessterEscrow, ChessterEscrowClient, EscrowError, EscrowErrorExt};
use soroban_sdk::{
    testutils::Address as _,
    token::{Client as TokenClient, StellarAssetClient as TokenAdminClient},
    Address, Env, String,
};

/// Keep the public error-code ABI explicit for clients that decode Soroban
/// contract failures. New errors must be appended rather than renumbered.
#[test]
fn escrow_error_codes_are_stable_and_unique() {
    let codes = [
        EscrowError::NotInitialized as u32,
        EscrowError::MatchNotFound as u32,
        EscrowError::MatchAlreadyExists as u32,
        EscrowError::InvalidWager as u32,
    ];
    for (index, code) in codes.iter().enumerate() {
        assert_eq!(*code as usize, index);
    }
    assert_eq!(EscrowError::UnauthorizedPlayer as u32, 49);
    assert_eq!(EscrowErrorExt::ProposalExpired as u32, 50);
    assert_eq!(EscrowErrorExt::ArithmeticOverflow as u32, 51);
    assert_eq!(EscrowErrorExt::WagerBelowTokenMinimum as u32, 52);
    assert_eq!(EscrowErrorExt::MatchNotInTournament as u32, 53);
    assert_eq!(EscrowErrorExt::SideBetsNotSettled as u32, 54);
    assert_eq!(EscrowErrorExt::SideBetTokenMismatch as u32, 55);
    assert_eq!(EscrowErrorExt::AlreadyInitialized as u32, 56);
    assert_eq!(EscrowErrorExt::TimelockNotExpired as u32, 57);
    assert_eq!(EscrowErrorExt::NotPauseGuardian as u32, 58);
    assert_eq!(EscrowErrorExt::UnpauseNotRequested as u32, 59);
    assert_eq!(EscrowErrorExt::SelfMatchNotAllowed as u32, 60);
    assert_eq!(EscrowErrorExt::InvalidAddress as u32, 61);
}

#[test]
fn test_create_match_rejects_self_challenge() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator = Address::generate(&env);
    let player = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token = token_id.address();
    let token_client = TokenClient::new(&env, &token);
    let token_admin_client = TokenAdminClient::new(&env, &token);
    let contract_id = env.register(ChessterEscrow, ());
    let client = ChessterEscrowClient::new(&env, &contract_id);

    token_admin_client.mint(&player, &1);
    token_client.approve(&player, &contract_id, &1, &(env.ledger().sequence() + 100));
    client.init(&coordinator, &500);
    client.add_whitelisted_token(&token);

    let game_code = String::from_str(&env, "SELF_CHALLENGE");
    client.create_match(&game_code, &player, &token, &1);

    let result = client.try_join_match(&game_code, &player);
    assert_eq!(
        result.unwrap_err(),
        Ok(soroban_sdk::Error::from_contract_error(
            EscrowErrorExt::SelfMatchNotAllowed as u32
        ))
    );
}
