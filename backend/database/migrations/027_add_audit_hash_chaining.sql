-- Migration: Add cryptographic hash chaining to match_audit_logs
-- Implements tamper-evident audit log integrity verification
-- Each log entry contains:
--   - prev_hash: SHA-256 hash of the previous entry in the chain for the same game
--   - record_hash: SHA-256 hash of current entry and its predecessor

-- Add hash columns to match_audit_logs table
ALTER TABLE match_audit_logs
ADD COLUMN IF NOT EXISTS prev_hash VARCHAR(64),
ADD COLUMN IF NOT EXISTS record_hash VARCHAR(64);

-- Create indexes on hash columns for quick lookups during chain verification
CREATE INDEX IF NOT EXISTS idx_audit_logs_record_hash ON match_audit_logs(record_hash);
CREATE INDEX IF NOT EXISTS idx_audit_logs_game_id_created_at ON match_audit_logs(game_id, created_at);

-- Add constraint: record_hash must be 64 character hex string (SHA-256)
ALTER TABLE match_audit_logs
ADD CONSTRAINT ck_record_hash_valid CHECK (
  record_hash IS NULL OR (
    record_hash ~ '^[0-9a-f]{64}$' AND length(record_hash) = 64
  )
);

-- Add constraint: prev_hash must be either NULL (genesis entry) or 64 character hex string
ALTER TABLE match_audit_logs
ADD CONSTRAINT ck_prev_hash_valid CHECK (
  prev_hash IS NULL OR (
    prev_hash ~ '^[0-9a-f]{64}$' AND length(prev_hash) = 64
  )
);

-- Create a function to compute the SHA-256 hash of an audit log entry
-- This function is called by the trigger before inserting each new record
CREATE OR REPLACE FUNCTION compute_audit_record_hash(
  p_prev_hash VARCHAR(64),
  p_game_id UUID,
  p_event_type VARCHAR(50),
  p_event_data JSONB,
  p_player_address VARCHAR(255),
  p_coordinator_tx_hash TEXT,
  p_created_at TIMESTAMP WITH TIME ZONE
) RETURNS VARCHAR(64) AS $$
DECLARE
  v_content TEXT;
  v_hash BYTEA;
BEGIN
  -- Build canonical string: prev_hash|game_id|event_type|event_data|player_address|coordinator_tx_hash|created_at
  -- Use COALESCE to normalize NULL values to empty string for consistent hashing
  v_content := COALESCE(p_prev_hash, '0000000000000000000000000000000000000000000000000000000000000000') ||
              '|' || CAST(p_game_id AS TEXT) ||
              '|' || p_event_type ||
              '|' || CAST(p_event_data AS TEXT) ||
              '|' || COALESCE(p_player_address, '') ||
              '|' || COALESCE(p_coordinator_tx_hash, '') ||
              '|' || CAST(p_created_at AS TEXT);
  
  -- Compute SHA-256 hash
  v_hash := digest(v_content, 'sha256');
  
  -- Return as hex string
  RETURN encode(v_hash, 'hex');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Create trigger to automatically compute hashes on INSERT
CREATE OR REPLACE FUNCTION trigger_audit_log_hash_chain()
RETURNS TRIGGER AS $$
DECLARE
  v_prev_hash VARCHAR(64);
  v_record_hash VARCHAR(64);
BEGIN
  -- Fetch the record_hash of the most recent audit log for this game_id
  -- This becomes the prev_hash for the new entry
  SELECT record_hash INTO v_prev_hash
  FROM match_audit_logs
  WHERE game_id = NEW.game_id
  ORDER BY created_at DESC, id DESC
  LIMIT 1;
  
  -- If no previous entry exists, set prev_hash to null (genesis entry)
  -- The hash function will treat NULL as all zeros
  v_prev_hash := COALESCE(v_prev_hash, NULL);
  
  -- Compute the record_hash for this new entry
  v_record_hash := compute_audit_record_hash(
    v_prev_hash,
    NEW.game_id,
    NEW.event_type,
    NEW.event_data,
    NEW.player_address,
    NEW.coordinator_tx_hash,
    NEW.created_at
  );
  
  -- Set the computed hashes on the new record
  NEW.prev_hash := v_prev_hash;
  NEW.record_hash := v_record_hash;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if it exists (to allow re-running migrations)
DROP TRIGGER IF NOT EXISTS audit_log_hash_chain_trigger ON match_audit_logs;

-- Create trigger that fires before insert
CREATE TRIGGER audit_log_hash_chain_trigger
BEFORE INSERT ON match_audit_logs
FOR EACH ROW
EXECUTE FUNCTION trigger_audit_log_hash_chain();

-- Create a function to verify the hash chain for a specific game
-- Returns a record with: is_valid (boolean), first_invalid_index (int), tampering_details (text)
CREATE OR REPLACE FUNCTION verify_match_audit_chain(p_game_id UUID)
RETURNS TABLE (
  is_valid BOOLEAN,
  first_invalid_index INTEGER,
  tampering_details TEXT,
  total_entries INTEGER
) AS $$
DECLARE
  v_entry RECORD;
  v_prev_hash VARCHAR(64);
  v_expected_hash VARCHAR(64);
  v_index INTEGER := 0;
  v_total_entries INTEGER;
BEGIN
  -- Count total entries for this game
  SELECT COUNT(*) INTO v_total_entries
  FROM match_audit_logs
  WHERE game_id = p_game_id;
  
  -- If no entries, return valid
  IF v_total_entries = 0 THEN
    RETURN QUERY SELECT true, NULL::INTEGER, 'No entries in audit chain'::TEXT, 0;
    RETURN;
  END IF;
  
  -- Process each entry in chronological order
  FOR v_entry IN
    SELECT id, event_type, event_data, player_address, coordinator_tx_hash, created_at, prev_hash, record_hash
    FROM match_audit_logs
    WHERE game_id = p_game_id
    ORDER BY created_at ASC, id ASC
  LOOP
    v_index := v_index + 1;
    
    -- Check if prev_hash matches expected value
    IF v_index = 1 THEN
      -- First entry should have prev_hash as NULL
      IF v_entry.prev_hash IS NOT NULL THEN
        RETURN QUERY SELECT false, v_index, 'Genesis entry has non-NULL prev_hash: ' || COALESCE(v_entry.prev_hash, 'NULL')::TEXT, v_total_entries;
        RETURN;
      END IF;
      v_prev_hash := NULL;
    ELSE
      -- Subsequent entries: prev_hash should match previous entry's record_hash
      IF v_entry.prev_hash IS DISTINCT FROM v_prev_hash THEN
        RETURN QUERY SELECT false, v_index, 'Broken chain link at entry ' || v_index || ': expected prev_hash=' || COALESCE(v_prev_hash, 'NULL') || ', got ' || COALESCE(v_entry.prev_hash, 'NULL'), v_total_entries;
        RETURN;
      END IF;
    END IF;
    
    -- Recompute what the record_hash should be
    v_expected_hash := compute_audit_record_hash(
      v_entry.prev_hash,
      p_game_id,
      v_entry.event_type,
      v_entry.event_data,
      v_entry.player_address,
      v_entry.coordinator_tx_hash,
      v_entry.created_at
    );
    
    -- Check if stored record_hash matches computed hash
    IF v_entry.record_hash != v_expected_hash THEN
      RETURN QUERY SELECT false, v_index, 'Tampered entry at index ' || v_index || ': stored_hash=' || v_entry.record_hash || ' != computed_hash=' || v_expected_hash, v_total_entries;
      RETURN;
    END IF;
    
    -- Update v_prev_hash for next iteration
    v_prev_hash := v_entry.record_hash;
  END LOOP;
  
  -- All entries validated successfully
  RETURN QUERY SELECT true, NULL::INTEGER, 'Chain integrity verified for ' || v_total_entries || ' entries', v_total_entries;
END;
$$ LANGUAGE plpgsql;
