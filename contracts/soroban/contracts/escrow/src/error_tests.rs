#![cfg(test)]

use super::EscrowError;

/// Keep the public error-code ABI explicit for clients that decode Soroban
/// contract failures. New errors must be appended rather than renumbered.
#[test]
fn escrow_error_codes_are_stable_and_unique() {
    let codes = [
        EscrowError::NotInitialized as u32,
        EscrowError::MatchNotFound as u32,
        EscrowError::MatchAlreadyExists as u32,
        EscrowError::InvalidWager as u32,
        EscrowError::ProposalExpired as u32,
    ];
    for (index, code) in codes.iter().enumerate() {
        assert_eq!(*code as usize, if index == 4 { 50 } else { index });
    }
}
