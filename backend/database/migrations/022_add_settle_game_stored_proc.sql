-- Migration: 022_add_settle_game_stored_proc.sql
-- Description: Stored procedure for atomic escrow state transition, match audit logging, and player stat counters (Issue #322)

-- UP
CREATE OR REPLACE FUNCTION settle_game_transactionally(
    p_game_id UUID,
    p_winner TEXT,
    p_tx_hash TEXT,
    p_reason TEXT
) RETURNS VOID AS $HOME\Desktop\OS\resolve-all-assigned-issues.ps1
DECLARE
    v_white_address TEXT;
    v_black_address TEXT;
    v_status TEXT;
BEGIN
    -- 1. Select and lock target game row to ensure concurrency control
    SELECT player_white_address, player_black_address, status
    INTO v_white_address, v_black_address, v_status
    FROM games
    WHERE id = p_game_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Game with ID % does not exist', p_game_id;
    END IF;

    -- 2. Atomically transition game state to completed
    UPDATE games
    SET status = 'completed',
        winner = p_winner,
        escrow_tx_hash = p_tx_hash,
        escrow_status = 'settled',
        ended_at = NOW()
    WHERE id = p_game_id;

    -- 3. Insert audit resolution entry
    INSERT INTO match_audit_logs (game_id, event_type, event_data, coordinator_tx_hash)
    VALUES (
        p_game_id,
        'GAME_RESOLVED',
        jsonb_build_object(
            'winner', p_winner,
            'reason', p_reason,
            'tx_hash', p_tx_hash,
            'resolved_at', NOW()
        ),
        p_tx_hash
    );

    -- 4. Atomically update player win/loss records
    IF p_winner = 'white' THEN
        IF v_white_address IS NOT NULL THEN
            UPDATE players SET wins = wins + 1, updated_at = NOW() WHERE wallet_address = v_white_address;
        END IF;
        IF v_black_address IS NOT NULL THEN
            UPDATE players SET losses = losses + 1, updated_at = NOW() WHERE wallet_address = v_black_address;
        END IF;
    ELSIF p_winner = 'black' THEN
        IF v_black_address IS NOT NULL THEN
            UPDATE players SET wins = wins + 1, updated_at = NOW() WHERE wallet_address = v_black_address;
        END IF;
        IF v_white_address IS NOT NULL THEN
            UPDATE players SET losses = losses + 1, updated_at = NOW() WHERE wallet_address = v_white_address;
        END IF;
    END IF;

END;
$HOME\Desktop\OS\resolve-all-assigned-issues.ps1 LANGUAGE plpgsql;

-- DOWN
DROP FUNCTION IF EXISTS settle_game_transactionally(UUID, TEXT, TEXT, TEXT);