#![cfg(test)]

use super::{EscrowError, EscrowErrorExt};

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
}
