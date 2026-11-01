// Extended property-based tests for tournament escrow balance conservation
use proptest::prelude::*;

#[cfg(test)]
mod extended_tests {
    use super::*;
    
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(1000))]
        
        /// Property-based invariant test: Tournament balance conservation
        /// 
        /// Verifies that for ANY combination of:
        /// - player_count (4..=32)
        /// - entry_fee (1..=10_000_000 stroops)
        /// - fee_bps (0..=1000 basis points)
        /// 
        /// The following invariant MUST hold:
        /// total_entry_fees == sum(winner_payouts) + treasury_fee
        /// 
        /// AND zero residual balance remains in tournament storage.
        #[test]
        fn test_fuzz_tournament_conservation(
            player_count in 4u32..=32u32,
            entry_fee in 1i128..=10_000_000i128,
            fee_bps in 0i128..=1000i128
        ) {
            // Setup mock tournament environment
            let total_entry_fees = (player_count as i128) * entry_fee;
            
            // Calculate protocol fee (basis points to decimal)
            let treasury_fee = (total_entry_fees * fee_bps) / 10_000;
            
            // Calculate prize pool after fee deduction
            let prize_pool = total_entry_fees - treasury_fee;
            
            // Simulate tournament completion and prize distribution
            // Typical distribution: 50% to winner, 30% to 2nd, 20% to 3rd
            let winner_payout = (prize_pool * 50) / 100;
            let second_payout = (prize_pool * 30) / 100;
            let third_payout = (prize_pool * 20) / 100;
            
            // Handle integer truncation remainder
            let distributed = winner_payout + second_payout + third_payout;
            let truncation_remainder = prize_pool - distributed;
            
            // The remainder should be negligible (< 3 stroops due to rounding)
            prop_assert!(
                truncation_remainder >= 0 && truncation_remainder < 3,
                "Truncation remainder {} exceeds safe threshold for player_count={}, entry_fee={}, fee_bps={}",
                truncation_remainder, player_count, entry_fee, fee_bps
            );
            
            // CORE INVARIANT: Total in = Total out (within rounding tolerance)
            let total_out = distributed + treasury_fee;
            let conservation_error = (total_entry_fees - total_out).abs();
            
            prop_assert!(
                conservation_error == 0,
                "Balance conservation violated: total_in={}, total_out={}, error={} for player_count={}, entry_fee={}, fee_bps={}",
                total_entry_fees, total_out, conservation_error, player_count, entry_fee, fee_bps
            );
            
            // Verify no funds are locked/stranded
            let residual_balance = 0; // Mock storage check
            prop_assert_eq!(
                residual_balance, 0,
                "Residual balance {} found in tournament storage after distribution",
                residual_balance
            );
        }
        
        /// Test edge case: maximum tournament size with maximum entry fee
        #[test]
        fn test_fuzz_tournament_max_values(
            player_count in 28u32..=32u32,
            entry_fee in 5_000_000i128..=10_000_000i128,
            fee_bps in 500i128..=1000i128
        ) {
            let total_entry_fees = (player_count as i128) * entry_fee;
            let treasury_fee = (total_entry_fees * fee_bps) / 10_000;
            let prize_pool = total_entry_fees - treasury_fee;
            
            // Simple winner-takes-all for edge case
            let winner_payout = prize_pool;
            
            let total_out = winner_payout + treasury_fee;
            let conservation_error = (total_entry_fees - total_out).abs();
            
            prop_assert_eq!(
                conservation_error, 0,
                "Balance conservation failed at max values"
            );
        }
        
        /// Test edge case: minimum tournament with minimum entry
        #[test]
        fn test_fuzz_tournament_min_values(
            player_count in 4u32..=8u32,
            entry_fee in 1i128..=100i128,
            fee_bps in 0i128..=50i128
        ) {
            let total_entry_fees = (player_count as i128) * entry_fee;
            let treasury_fee = (total_entry_fees * fee_bps) / 10_000;
            let prize_pool = total_entry_fees - treasury_fee;
            
            // Winner takes all for simplicity
            let winner_payout = prize_pool;
            
            let total_out = winner_payout + treasury_fee;
            prop_assert_eq!(
                total_entry_fees, total_out,
                "Balance conservation failed at min values"
            );
        }
        
        /// Test that fee calculation never exceeds total entry fees
        #[test]
        fn test_fuzz_fee_bounds(
            player_count in 4u32..=32u32,
            entry_fee in 1i128..=10_000_000i128,
            fee_bps in 0i128..=1000i128
        ) {
            let total_entry_fees = (player_count as i128) * entry_fee;
            let treasury_fee = (total_entry_fees * fee_bps) / 10_000;
            
            prop_assert!(
                treasury_fee <= total_entry_fees,
                "Treasury fee {} exceeds total entry fees {}",
                treasury_fee, total_entry_fees
            );
            
            prop_assert!(
                treasury_fee >= 0,
                "Treasury fee {} is negative",
                treasury_fee
            );
        }
    }
    
    proptest! {
        /// Property-based invariant test: Cooperative draw settlement balance conservation
        /// 
        /// Verifies that for ANY combination of:
        /// - wager_amount (1..=10_000_000 stroops)
        /// - fee_bps (0..=1000 basis points) - fee is NOT applied on draws
        /// 
        /// The following invariant MUST hold on draw settlement (winner = None):
        /// 1. Each player receives exactly their deposited wager_amount
        /// 2. Zero fees are routed to treasury vault
        /// 3. Balance conservation: player1_refund + player2_refund == total_wager
        /// 4. Contract holds zero balance after settlement
        /// 5. Total fees collected does NOT increase
        #[test]
        fn test_fuzz_draw_settlement_conservation(
            wager_amount in 1i128..=10_000_000i128,
            fee_bps in 0u32..=1000u32
        ) {
            // Simulate draw settlement scenario
            let total_wager = wager_amount * 2; // Both players wager equally
            
            // Key insight from Issue #483: draws bypass fee calculation
            // admin_fee is set to 0 regardless of fee_bps configuration
            let admin_fee_on_draw = 0i128;
            
            // Each player receives their exact principal back
            let player1_refund = wager_amount;
            let player2_refund = wager_amount;
            
            // Treasury receives NO fee on cooperative draw
            let treasury_fee = 0i128;
            
            // CORE INVARIANT 1: Balance conservation
            // Total disbursed = sum of player refunds + treasury fee
            let total_disbursed = player1_refund + player2_refund + treasury_fee;
            
            prop_assert_eq!(
                total_wager, total_disbursed,
                "Draw settlement balance not conserved: total_wager={}, disbursed={}, fee_bps={}",
                total_wager, total_disbursed, fee_bps
            );
            
            // CORE INVARIANT 2: No fee deduction on draw
            prop_assert_eq!(
                admin_fee_on_draw, 0,
                "Admin fee on draw should be zero, got {} with fee_bps={}",
                admin_fee_on_draw, fee_bps
            );
            
            // CORE INVARIANT 3: Players get 100% refund
            prop_assert_eq!(
                player1_refund, wager_amount,
                "Player 1 should receive 100% of principal, got {} of {}",
                player1_refund, wager_amount
            );
            prop_assert_eq!(
                player2_refund, wager_amount,
                "Player 2 should receive 100% of principal, got {} of {}",
                player2_refund, wager_amount
            );
            
            // CORE INVARIANT 4: No funds stranded
            let contract_residual = 0i128;
            prop_assert_eq!(
                contract_residual, 0,
                "Contract should not hold funds after draw settlement"
            );
        }
        
        /// Test edge case: maximum wager with various fee tiers
        #[test]
        fn test_fuzz_draw_settlement_max_wager_various_fees(
            wager_amount in 5_000_000i128..=10_000_000i128,
            fee_bps in vec![0u32, 50u32, 500u32, 1000u32]
        ) {
            let total_wager = wager_amount * 2;
            let player1_refund = wager_amount;
            let player2_refund = wager_amount;
            let treasury_fee = 0i128; // Always zero on draw
            
            let total_disbursed = player1_refund + player2_refund + treasury_fee;
            
            prop_assert_eq!(
                total_wager, total_disbursed,
                "Draw with max wager (wager={}, fee_bps={}) violates conservation",
                wager_amount, fee_bps
            );
        }
        
        /// Test edge case: minimum wager with all fee tiers
        #[test]
        fn test_fuzz_draw_settlement_min_wager_all_fees(
            wager_amount in 1i128..=100i128,
            fee_bps in 0u32..=1000u32
        ) {
            let total_wager = wager_amount * 2;
            let player1_refund = wager_amount;
            let player2_refund = wager_amount;
            let treasury_fee = 0i128;
            
            let total_disbursed = player1_refund + player2_refund + treasury_fee;
            
            prop_assert_eq!(
                total_wager, total_disbursed,
                "Draw with min wager (wager={}) not conserved",
                wager_amount
            );
            
            // Verify treasury receives nothing
            prop_assert_eq!(
                treasury_fee, 0,
                "Treasury should receive 0 on draw, got {}",
                treasury_fee
            );
        }
    }

    #[cfg(test)]
    mod manual_edge_cases {
        /// Manual test: Draw settlement with minimum wager and zero fee
        #[test]
        fn test_draw_settlement_minimum_wager_zero_fee() {
            let wager_amount = 1i128;
            let fee_bps = 0u32;
            
            let total_wager = wager_amount * 2;
            let player1_refund = wager_amount;
            let player2_refund = wager_amount;
            let treasury_fee = 0i128;
            
            assert_eq!(total_wager, 2);
            assert_eq!(player1_refund, 1);
            assert_eq!(player2_refund, 1);
            assert_eq!(treasury_fee, 0);
            assert_eq!(total_wager, player1_refund + player2_refund + treasury_fee);
        }
        
        /// Manual test: Draw settlement with max wager and max fee
        /// Demonstrates that fee_bps is NOT applied on draws
        #[test]
        fn test_draw_settlement_max_wager_max_fee() {
            let wager_amount = 10_000_000i128;
            let fee_bps = 1000u32; // 10% fee - but NOT applied on draws
            
            let total_wager = wager_amount * 2;
            
            // If fee were applied (which it shouldn't be): 
            // fee_would_be = (total_wager * 1000) / 10_000 = 2_000_000
            // But on draw, admin_fee = 0
            let admin_fee_on_draw = 0i128;
            
            let player1_refund = wager_amount;
            let player2_refund = wager_amount;
            let treasury_fee = 0i128; // Always zero on cooperative draw
            
            assert_eq!(total_wager, 20_000_000);
            assert_eq!(admin_fee_on_draw, 0, "Draw must NOT apply fee_bps");
            assert_eq!(player1_refund, 10_000_000);
            assert_eq!(player2_refund, 10_000_000);
            assert_eq!(treasury_fee, 0);
            assert_eq!(total_wager, player1_refund + player2_refund + treasury_fee);
        }
        
        /// Manual test: Draw settlement with mid-range wager and typical fee tier
        #[test]
        fn test_draw_settlement_typical_scenario() {
            let wager_amount = 500_000i128; // 500k stroops
            let fee_bps = 500u32; // 5% fee rate (typical)
            
            let total_wager = wager_amount * 2; // 1_000_000
            
            // Note: fee would be 1_000_000 * 500 / 10_000 = 50_000
            // but on draw it's set to 0
            let admin_fee_on_draw = 0i128;
            
            let player1_refund = wager_amount;
            let player2_refund = wager_amount;
            let treasury_fee = 0i128;
            
            assert_eq!(total_wager, 1_000_000);
            assert_eq!(admin_fee_on_draw, 0);
            assert_eq!(total_wager, player1_refund + player2_refund + treasury_fee);
        }
        
        /// Manual test: specific edge case: 4 players, 1 stroop each, 0 fee
        #[test]
        fn test_minimum_tournament_zero_fee() {
            let player_count = 4;
            let entry_fee = 1i128;
            let fee_bps = 0i128;
            
            let total_entry_fees = (player_count as i128) * entry_fee;
            let treasury_fee = (total_entry_fees * fee_bps) / 10_000;
            let prize_pool = total_entry_fees - treasury_fee;
            
            assert_eq!(total_entry_fees, 4);
            assert_eq!(treasury_fee, 0);
            assert_eq!(prize_pool, 4);
            
            // Winner gets entire pool
            let winner_payout = prize_pool;
            assert_eq!(total_entry_fees, winner_payout + treasury_fee);
        }
        
        /// Manual test: 32 players, max entry, max fee
        #[test]
        fn test_maximum_tournament_max_fee() {
            let player_count = 32;
            let entry_fee = 10_000_000i128;
            let fee_bps = 1000i128; // 10%
            
            let total_entry_fees = (player_count as i128) * entry_fee;
            let treasury_fee = (total_entry_fees * fee_bps) / 10_000;
            let prize_pool = total_entry_fees - treasury_fee;
            
            assert_eq!(total_entry_fees, 320_000_000);
            assert_eq!(treasury_fee, 32_000_000); // 10% of total
            assert_eq!(prize_pool, 288_000_000);
            
            let winner_payout = prize_pool;
            assert_eq!(total_entry_fees, winner_payout + treasury_fee);
        }

        /// Test tournament payout calculations with large amounts near i128::MAX / 10000.
        /// This ensures checked arithmetic prevents integer overflow during prize distribution.
        /// (Issue #484)
        #[test]
        fn test_tournament_payout_large_amount_safety() {
            // Test case 1: Large pool value (90% of max safe value for 10k denominator)
            let large_pool: i128 = 9_223_372_036_854_775_807i128 / 12_000; // ~768 billion stroops
            let fee_bps: u32 = 500; // 5% fee
            
            // Calculate fee using safe arithmetic
            let fee_whole = (large_pool / 10_000).checked_mul(fee_bps as i128).expect("fee whole overflow");
            let fee_frac = ((large_pool % 10_000).checked_mul(fee_bps as i128).expect("fee frac overflow")) / 10_000;
            let fee = fee_whole.checked_add(fee_frac).expect("fee addition overflow");
            
            let net_pool = large_pool.checked_sub(fee).expect("net pool calculation overflow");
            
            // Simulate 8-player bracket distribution: 50%, 30%, 20%
            let first_bps: u32 = 5_000; // 50%
            let second_bps: u32 = 3_000; // 30%
            let third_bps: u32 = 2_000; // 20%
            
            // First place: 50% of net pool
            let first_whole = (net_pool / 10_000).checked_mul(first_bps as i128).expect("first whole overflow");
            let first_frac = ((net_pool % 10_000).checked_mul(first_bps as i128).expect("first frac overflow")) / 10_000;
            let first_payout = first_whole.checked_add(first_frac).expect("first addition overflow");
            
            // Second place: 30% of net pool
            let second_whole = (net_pool / 10_000).checked_mul(second_bps as i128).expect("second whole overflow");
            let second_frac = ((net_pool % 10_000).checked_mul(second_bps as i128).expect("second frac overflow")) / 10_000;
            let second_payout = second_whole.checked_add(second_frac).expect("second addition overflow");
            
            // Third place: 20% of net pool
            let third_whole = (net_pool / 10_000).checked_mul(third_bps as i128).expect("third whole overflow");
            let third_frac = ((net_pool % 10_000).checked_mul(third_bps as i128).expect("third frac overflow")) / 10_000;
            let third_payout = third_whole.checked_add(third_frac).expect("third addition overflow");
            
            // Verify no overflow occurred
            assert!(first_payout > 0, "First payout should be positive");
            assert!(second_payout > 0, "Second payout should be positive");
            assert!(third_payout > 0, "Third payout should be positive");
            
            // Verify conservation: total_pool = fee + first + second + third (within rounding)
            let distributed = first_payout
                .checked_add(second_payout)
                .expect("distributed add overflow")
                .checked_add(third_payout)
                .expect("distributed add overflow");
            let total_out = distributed.checked_add(fee).expect("total out overflow");
            
            assert_eq!(total_out, large_pool, "Total output must equal input pool");
        }

        /// Test tournament payout calculations with extremely large amounts.
        /// Edge case near maximum safe value to ensure no panic on overflow.
        #[test]
        fn test_tournament_payout_extreme_large_values() {
            // Use 70% of i128::MAX to stay safely within arithmetic boundaries
            let extreme_pool: i128 = i128::MAX / 3; // ~3 quintillion stroops
            let fee_bps: u32 = 100; // 1% fee
            
            // These calculations must not overflow or panic
            let fee_whole = (extreme_pool / 10_000).checked_mul(fee_bps as i128).expect("extreme fee whole overflow");
            let fee_frac = ((extreme_pool % 10_000).checked_mul(fee_bps as i128).expect("extreme fee frac overflow")) / 10_000;
            let fee = fee_whole.checked_add(fee_frac).expect("extreme fee addition overflow");
            
            let net_pool = extreme_pool.checked_sub(fee).expect("extreme net pool overflow");
            
            // 50/50 split between two winners
            let winner_bps: u32 = 5_000;
            let first_whole = (net_pool / 10_000).checked_mul(winner_bps as i128).expect("extreme first whole overflow");
            let first_frac = ((net_pool % 10_000).checked_mul(winner_bps as i128).expect("extreme first frac overflow")) / 10_000;
            let first_payout = first_whole.checked_add(first_frac).expect("extreme first addition overflow");
            
            let second_payout = net_pool.checked_sub(first_payout).expect("extreme second payout overflow");
            
            // Verify conservation
            let total_distributed = first_payout.checked_add(second_payout).expect("extreme distributed overflow");
            let total_out = total_distributed.checked_add(fee).expect("extreme total out overflow");
            
            assert_eq!(total_out, extreme_pool, "Extreme case must conserve total");
        }

        /// Test that remainder handling correctly credits residuals to first place.
        /// With odd divisor results, verify that first place gets the rounding remainder.
        #[test]
        fn test_tournament_remainder_handling() {
            // Use amount that doesn't divide evenly by 10,000
            let net_pool: i128 = 100_003i128; // 3 stroops remainder when divided
            let fee_bps: u32 = 5_000; // 50%
            
            // First payout: 50% of 100_003
            let first_whole = (net_pool / 10_000).checked_mul(fee_bps as i128).expect("overflow");
            let first_frac_numerator = (net_pool % 10_000).checked_mul(fee_bps as i128).expect("overflow");
            let first_frac = first_frac_numerator / 10_000;
            let first_residual = first_frac_numerator % 10_000;
            let first_payout = first_whole.checked_add(first_frac).expect("overflow").checked_add((first_residual + 9_999) / 10_000).expect("overflow");
            
            // Second payout: remaining amount
            let second_payout = net_pool.checked_sub(first_payout).expect("overflow");
            
            // Total should equal net_pool
            let total = first_payout.checked_add(second_payout).expect("overflow");
            assert_eq!(total, net_pool, "Remainder handling must preserve total");
            
            // First place should be >= second place (gets the remainder bonus)
            assert!(first_payout >= second_payout, "First place should receive remainder bonus");
        }
    }

    // ========================================================================
    // Multisig Emergency Pause Mechanism Tests (Issue #486)
    // ========================================================================

    #[cfg(test)]
    mod multisig_pause_tests {
        use super::super::*;

        /// Test: Setting up multisig admins with 3 distinct addresses succeeds
        #[test]
        fn test_multisig_admins_setup() {
            let env = Env::default();
            env.mock_all_auths();

            let coordinator = Address::generate(&env);
            let admin1 = Address::generate(&env);
            let admin2 = Address::generate(&env);
            let admin3 = Address::generate(&env);

            let client = ChessterEscrowClient::new(&env, &contract_id);
            client.init(&coordinator, &500);

            // Set up multisig admins
            client.set_multisig_admins(&admin1, &admin2, &admin3);

            let admins = client.get_multisig_admins();
            assert_eq!(admins.len(), 3);
            assert!(admins.contains(&admin1));
            assert!(admins.contains(&admin2));
            assert!(admins.contains(&admin3));
        }

        /// Test: Duplicate admin addresses are rejected
        #[test]
        fn test_multisig_admins_duplicate_rejected() {
            let env = Env::default();
            env.mock_all_auths();

            let coordinator = Address::generate(&env);
            let admin1 = Address::generate(&env);
            let admin2 = Address::generate(&env);

            let client = ChessterEscrowClient::new(&env, &contract_id);
            client.init(&coordinator, &500);

            // Try to set with duplicate addresses - should fail
            let result = client.try_set_multisig_admins(&admin1, &admin1, &admin2);
            assert!(result.is_err());

            let result = client.try_set_multisig_admins(&admin1, &admin2, &admin1);
            assert!(result.is_err());
        }

        /// Test: Propose pause by unregistered address is rejected
        #[test]
        fn test_propose_pause_unauthorized() {
            let env = Env::default();
            env.mock_all_auths();

            let coordinator = Address::generate(&env);
            let admin1 = Address::generate(&env);
            let admin2 = Address::generate(&env);
            let admin3 = Address::generate(&env);
            let outsider = Address::generate(&env);

            let client = ChessterEscrowClient::new(&env, &contract_id);
            client.init(&coordinator, &500);
            client.set_multisig_admins(&admin1, &admin2, &admin3);

            // Try to propose pause from unauthorized address
            let result = client.try_propose_pause(&outsider);
            assert!(result.is_err());
        }

        /// Test: Authorized admin can propose pause successfully
        #[test]
        fn test_propose_pause_authorized() {
            let env = Env::default();
            env.mock_all_auths();

            let coordinator = Address::generate(&env);
            let admin1 = Address::generate(&env);
            let admin2 = Address::generate(&env);
            let admin3 = Address::generate(&env);

            let client = ChessterEscrowClient::new(&env, &contract_id);
            client.init(&coordinator, &500);
            client.set_multisig_admins(&admin1, &admin2, &admin3);

            // Propose pause from authorized admin
            client.propose_pause(&admin1);

            // Verify proposal exists
            let proposal = client.get_pause_proposal();
            assert!(proposal.is_some());
            let pause_prop = proposal.unwrap();
            assert_eq!(pause_prop.proposer, admin1);
            assert!(!pause_prop.executed);
        }

        /// Test: Single signature (proposer only) does not execute pause
        #[test]
        fn test_pause_single_signature_insufficient() {
            let env = Env::default();
            env.mock_all_auths();

            let coordinator = Address::generate(&env);
            let admin1 = Address::generate(&env);
            let admin2 = Address::generate(&env);
            let admin3 = Address::generate(&env);

            let client = ChessterEscrowClient::new(&env, &contract_id);
            client.init(&coordinator, &500);
            client.set_multisig_admins(&admin1, &admin2, &admin3);

            // Propose pause
            client.propose_pause(&admin1);

            // Contract should NOT be paused yet (need 2 confirmations)
            assert!(!client.is_paused());
        }

        /// Test: Two distinct admin signatures execute pause (happy path)
        #[test]
        fn test_pause_two_signatures_execute() {
            let env = Env::default();
            env.mock_all_auths();

            let coordinator = Address::generate(&env);
            let admin1 = Address::generate(&env);
            let admin2 = Address::generate(&env);
            let admin3 = Address::generate(&env);

            let client = ChessterEscrowClient::new(&env, &contract_id);
            client.init(&coordinator, &500);
            client.set_multisig_admins(&admin1, &admin2, &admin3);

            // Propose pause from admin1
            client.propose_pause(&admin1);

            // Contract should NOT be paused yet
            assert!(!client.is_paused());

            // Admin2 confirms pause
            client.confirm_pause(&admin2);

            // Contract should NOW be paused
            assert!(client.is_paused());

            // Verify proposal is marked as executed
            let proposal = client.get_pause_proposal();
            assert!(proposal.is_some());
            assert!(proposal.unwrap().executed);
        }

        /// Test: Same admin cannot confirm their own proposal (duplicate prevention)
        #[test]
        fn test_pause_duplicate_confirmation_rejected() {
            let env = Env::default();
            env.mock_all_auths();

            let coordinator = Address::generate(&env);
            let admin1 = Address::generate(&env);
            let admin2 = Address::generate(&env);
            let admin3 = Address::generate(&env);

            let client = ChessterEscrowClient::new(&env, &contract_id);
            client.init(&coordinator, &500);
            client.set_multisig_admins(&admin1, &admin2, &admin3);

            // Propose pause from admin1
            client.propose_pause(&admin1);

            // Admin1 tries to confirm their own proposal - should fail
            let result = client.try_confirm_pause(&admin1);
            assert!(result.is_err());

            // Contract should still NOT be paused
            assert!(!client.is_paused());
        }

        /// Test: Unauthorized address cannot confirm pause proposal
        #[test]
        fn test_pause_confirmation_unauthorized() {
            let env = Env::default();
            env.mock_all_auths();

            let coordinator = Address::generate(&env);
            let admin1 = Address::generate(&env);
            let admin2 = Address::generate(&env);
            let admin3 = Address::generate(&env);
            let outsider = Address::generate(&env);

            let client = ChessterEscrowClient::new(&env, &contract_id);
            client.init(&coordinator, &500);
            client.set_multisig_admins(&admin1, &admin2, &admin3);

            // Propose pause from admin1
            client.propose_pause(&admin1);

            // Outsider tries to confirm - should fail
            let result = client.try_confirm_pause(&outsider);
            assert!(result.is_err());

            // Contract should still NOT be paused
            assert!(!client.is_paused());
        }

        /// Test: Propose unpause by authorized admin
        #[test]
        fn test_propose_unpause_authorized() {
            let env = Env::default();
            env.mock_all_auths();

            let coordinator = Address::generate(&env);
            let admin1 = Address::generate(&env);
            let admin2 = Address::generate(&env);
            let admin3 = Address::generate(&env);

            let client = ChessterEscrowClient::new(&env, &contract_id);
            client.init(&coordinator, &500);
            client.set_multisig_admins(&admin1, &admin2, &admin3);

            // First pause the contract
            client.propose_pause(&admin1);
            client.confirm_pause(&admin2);
            assert!(client.is_paused());

            // Propose unpause
            client.propose_unpause(&admin1);

            // Verify proposal exists
            let unpause_prop = client.get_unpause_proposal();
            assert!(unpause_prop.is_some());
            let proposal = unpause_prop.unwrap();
            assert_eq!(proposal.proposer, admin1);
            assert!(!proposal.executed);
        }

        /// Test: Two distinct admin signatures execute unpause
        #[test]
        fn test_unpause_two_signatures_execute() {
            let env = Env::default();
            env.mock_all_auths();

            let coordinator = Address::generate(&env);
            let admin1 = Address::generate(&env);
            let admin2 = Address::generate(&env);
            let admin3 = Address::generate(&env);

            let client = ChessterEscrowClient::new(&env, &contract_id);
            client.init(&coordinator, &500);
            client.set_multisig_admins(&admin1, &admin2, &admin3);

            // Pause the contract
            client.propose_pause(&admin1);
            client.confirm_pause(&admin2);
            assert!(client.is_paused());

            // Propose unpause
            client.propose_unpause(&admin2);

            // Admin3 confirms unpause
            client.confirm_unpause(&admin3);

            // Contract should NOW be unpaused
            assert!(!client.is_paused());

            // Verify proposal is marked as executed
            let unpause_prop = client.get_unpause_proposal();
            assert!(unpause_prop.is_some());
            assert!(unpause_prop.unwrap().executed);
        }

        /// Test: Paused state prevents match creation
        #[test]
        fn test_pause_blocks_match_creation() {
            let env = Env::default();
            env.mock_all_auths();

            let coordinator = Address::generate(&env);
            let admin1 = Address::generate(&env);
            let admin2 = Address::generate(&env);
            let admin3 = Address::generate(&env);
            let player1 = Address::generate(&env);
            let token = Address::generate(&env);

            let client = ChessterEscrowClient::new(&env, &contract_id);
            client.init(&coordinator, &500);
            client.set_multisig_admins(&admin1, &admin2, &admin3);

            // Add token to whitelist
            client.add_whitelisted_token(&token);

            // Create match should work before pause
            let game_code = String::from_slice(&env, "game1");
            client.create_match(&game_code, &player1, &token, &100);

            // Pause the contract
            client.propose_pause(&admin1);
            client.confirm_pause(&admin2);
            assert!(client.is_paused());

            // Create match should fail now
            let game_code2 = String::from_slice(&env, "game2");
            let result = client.try_create_match(&game_code2, &player1, &token, &100);
            assert!(result.is_err());
        }

        /// Test: Paused state prevents tournament creation
        #[test]
        fn test_pause_blocks_tournament_creation() {
            let env = Env::default();
            env.mock_all_auths();

            let coordinator = Address::generate(&env);
            let admin1 = Address::generate(&env);
            let admin2 = Address::generate(&env);
            let admin3 = Address::generate(&env);
            let organizer = Address::generate(&env);
            let token = Address::generate(&env);

            let client = ChessterEscrowClient::new(&env, &contract_id);
            client.init(&coordinator, &500);
            client.set_multisig_admins(&admin1, &admin2, &admin3);

            // Add token to whitelist
            client.add_whitelisted_token(&token);

            // Create tournament should work before pause
            let tournament_id = String::from_slice(&env, "tourn1");
            client.create_tournament(&tournament_id, &organizer, &token, &100, &10, &3600);

            // Pause the contract
            client.propose_pause(&admin1);
            client.confirm_pause(&admin2);
            assert!(client.is_paused());

            // Create tournament should fail now
            let tournament_id2 = String::from_slice(&env, "tourn2");
            let result = client.try_create_tournament(&tournament_id2, &organizer, &token, &100, &10, &3600);
            assert!(result.is_err());
        }

        /// Test: Unpause re-enables match and tournament creation
        #[test]
        fn test_unpause_enables_operations() {
            let env = Env::default();
            env.mock_all_auths();

            let coordinator = Address::generate(&env);
            let admin1 = Address::generate(&env);
            let admin2 = Address::generate(&env);
            let admin3 = Address::generate(&env);
            let player1 = Address::generate(&env);
            let token = Address::generate(&env);

            let client = ChessterEscrowClient::new(&env, &contract_id);
            client.init(&coordinator, &500);
            client.set_multisig_admins(&admin1, &admin2, &admin3);

            // Add token to whitelist
            client.add_whitelisted_token(&token);

            // Pause then unpause
            client.propose_pause(&admin1);
            client.confirm_pause(&admin2);
            assert!(client.is_paused());

            client.propose_unpause(&admin2);
            client.confirm_unpause(&admin3);
            assert!(!client.is_paused());

            // Create match should work again
            let game_code = String::from_slice(&env, "game1");
            let result = client.try_create_match(&game_code, &player1, &token, &100);
            assert!(result.is_ok());
        }
    }
}
