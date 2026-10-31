/**
 * Audit Hash Utility Module
 *
 * Provides cryptographic hash chaining utilities for match event audit logs.
 * Each audit log entry forms a tamper-evident chain where:
 *   - prev_hash: SHA-256 hash of the previous entry's record_hash
 *   - record_hash: SHA-256 hash of the complete entry (prev_hash + game_id + action + payload + timestamp)
 *
 * If any entry is modified or deleted, the chain breaks and can be detected via verifyMatchAuditChain().
 */

const crypto = require("crypto");

/**
 * Compute canonical string representation for hash input.
 * Ensures deterministic hashing regardless of field order or JSON formatting.
 *
 * @param {string} prevHash - SHA-256 hash of previous entry (or null for genesis)
 * @param {string} gameId - UUID of the game
 * @param {string} eventType - Type of audit event
 * @param {object} eventData - Event payload as object
 * @param {string} playerAddress - Optional player wallet address
 * @param {string} coordinatorTxHash - Optional coordinator transaction hash
 * @param {Date|string} createdAt - Timestamp of the entry
 * @returns {string} Canonical string for hashing
 */
function canonicalAuditString(
  prevHash,
  gameId,
  eventType,
  eventData,
  playerAddress,
  coordinatorTxHash,
  createdAt
) {
  // Normalize inputs: convert undefined/null to empty string for consistency
  // Use all zeros for prevHash genesis entries
  const normalizedPrevHash =
    prevHash || "0000000000000000000000000000000000000000000000000000000000000000";
  const normalizedGameId = String(gameId || "");
  const normalizedEventType = String(eventType || "");
  const normalizedEventData = JSON.stringify(eventData || {});
  const normalizedPlayerAddress = String(playerAddress || "");
  const normalizedCoordinatorTxHash = String(coordinatorTxHash || "");
  const normalizedCreatedAt = String(createdAt || "");

  // Build canonical string with pipe delimiters
  // Order: prev_hash | game_id | event_type | event_data | player_address | coordinator_tx_hash | created_at
  return [
    normalizedPrevHash,
    normalizedGameId,
    normalizedEventType,
    normalizedEventData,
    normalizedPlayerAddress,
    normalizedCoordinatorTxHash,
    normalizedCreatedAt,
  ].join("|");
}

/**
 * Compute SHA-256 hash for a single audit log entry.
 *
 * @param {string} prevHash - SHA-256 hash of previous entry (or null for genesis)
 * @param {string} gameId - UUID of the game
 * @param {string} eventType - Type of audit event
 * @param {object} eventData - Event payload as object
 * @param {string} playerAddress - Optional player wallet address
 * @param {string} coordinatorTxHash - Optional coordinator transaction hash
 * @param {Date|string} createdAt - Timestamp of the entry
 * @returns {string} SHA-256 hash as hex string (64 characters)
 */
function computeRecordHash(
  prevHash,
  gameId,
  eventType,
  eventData,
  playerAddress,
  coordinatorTxHash,
  createdAt
) {
  const canonical = canonicalAuditString(
    prevHash,
    gameId,
    eventType,
    eventData,
    playerAddress,
    coordinatorTxHash,
    createdAt
  );

  return crypto.createHash("sha256").update(canonical).digest("hex");
}

/**
 * Verify the integrity of an audit log chain for a specific game.
 *
 * Checks that:
 * 1. The first entry (genesis) has prev_hash = null or all zeros
 * 2. Each subsequent entry's prev_hash matches the previous entry's record_hash
 * 3. Each entry's record_hash matches the recomputed hash
 * 4. No entries are missing (ordering is contiguous)
 *
 * @param {array} auditEntries - Array of audit log entries, sorted by created_at ascending
 * @returns {object} Verification result:
 *   {
 *     valid: boolean,
 *     tamperedIndex: number | null,  // Index of first tampered entry (null if all valid)
 *     error: string | null,           // Human-readable error message
 *     totalEntries: number,
 *     genesisHash: string            // record_hash of first entry (for reference)
 *   }
 */
function verifyMatchAuditChain(auditEntries) {
  if (!Array.isArray(auditEntries)) {
    return {
      valid: false,
      tamperedIndex: null,
      error: "Audit entries must be an array",
      totalEntries: 0,
      genesisHash: null,
    };
  }

  if (auditEntries.length === 0) {
    return {
      valid: true,
      tamperedIndex: null,
      error: null,
      totalEntries: 0,
      genesisHash: null,
    };
  }

  // Track expected prev_hash from previous iteration
  let expectedPrevHash = null;
  let genesisHash = null;

  for (let i = 0; i < auditEntries.length; i++) {
    const entry = auditEntries[i];

    // Validate entry structure
    if (!entry) {
      return {
        valid: false,
        tamperedIndex: i,
        error: `Entry at index ${i} is missing or null`,
        totalEntries: auditEntries.length,
        genesisHash,
      };
    }

    if (!entry.game_id || !entry.event_type || typeof entry.event_data !== "object") {
      return {
        valid: false,
        tamperedIndex: i,
        error: `Entry at index ${i} has missing or invalid required fields`,
        totalEntries: auditEntries.length,
        genesisHash,
      };
    }

    // Check prev_hash integrity
    const storedPrevHash = entry.prev_hash;
    if (expectedPrevHash !== null) {
      // Not genesis entry: prev_hash must match previous entry's record_hash
      if (storedPrevHash !== expectedPrevHash) {
        return {
          valid: false,
          tamperedIndex: i,
          error: `Broken chain link at index ${i}: expected prev_hash=${expectedPrevHash}, got ${storedPrevHash}`,
          totalEntries: auditEntries.length,
          genesisHash,
        };
      }
    } else {
      // Genesis entry: prev_hash should be null or zeros
      const allZeros = "0000000000000000000000000000000000000000000000000000000000000000";
      if (storedPrevHash && storedPrevHash !== allZeros) {
        return {
          valid: false,
          tamperedIndex: i,
          error: `Genesis entry at index ${i} has non-null prev_hash: ${storedPrevHash}`,
          totalEntries: auditEntries.length,
          genesisHash,
        };
      }
    }

    // Recompute record_hash
    const computedHash = computeRecordHash(
      storedPrevHash || null,
      entry.game_id,
      entry.event_type,
      entry.event_data,
      entry.player_address || null,
      entry.coordinator_tx_hash || null,
      entry.created_at
    );

    // Check record_hash integrity
    if (entry.record_hash !== computedHash) {
      return {
        valid: false,
        tamperedIndex: i,
        error: `Tampered entry at index ${i}: stored hash=${entry.record_hash}, computed hash=${computedHash}`,
        totalEntries: auditEntries.length,
        genesisHash,
      };
    }

    // Update expected prev_hash for next iteration
    expectedPrevHash = entry.record_hash;

    // Store genesis hash for reference
    if (i === 0) {
      genesisHash = entry.record_hash;
    }
  }

  return {
    valid: true,
    tamperedIndex: null,
    error: null,
    totalEntries: auditEntries.length,
    genesisHash,
  };
}

/**
 * Verify individual entry hash validity (without checking chain continuity).
 * Useful for auditing a specific entry without needing the full chain.
 *
 * @param {object} entry - Audit log entry
 * @param {string} expectedPrevHash - What the prev_hash should be (null for genesis)
 * @returns {object} Result:
 *   {
 *     valid: boolean,
 *     storedHash: string,
 *     computedHash: string,
 *     error: string | null
 *   }
 */
function verifyEntryHash(entry, expectedPrevHash = null) {
  if (!entry || typeof entry !== "object") {
    return {
      valid: false,
      storedHash: null,
      computedHash: null,
      error: "Invalid entry object",
    };
  }

  // Validate required fields
  if (!entry.game_id || !entry.event_type || typeof entry.event_data !== "object") {
    return {
      valid: false,
      storedHash: entry.record_hash || null,
      computedHash: null,
      error: "Entry missing required fields (game_id, event_type, event_data)",
    };
  }

  const computedHash = computeRecordHash(
    expectedPrevHash || null,
    entry.game_id,
    entry.event_type,
    entry.event_data,
    entry.player_address || null,
    entry.coordinator_tx_hash || null,
    entry.created_at
  );

  const isValid = entry.record_hash === computedHash;

  return {
    valid: isValid,
    storedHash: entry.record_hash || null,
    computedHash,
    error: isValid
      ? null
      : `Hash mismatch: stored=${entry.record_hash}, computed=${computedHash}`,
  };
}

/**
 * Build a chain verification report for audit logs (useful for debugging).
 *
 * @param {array} auditEntries - Array of audit log entries, sorted by created_at ascending
 * @returns {object} Detailed report with per-entry verification status
 */
function buildChainVerificationReport(auditEntries) {
  const verification = verifyMatchAuditChain(auditEntries);

  const entries = auditEntries.map((entry, index) => {
    const expectedPrevHash = index === 0 ? null : auditEntries[index - 1].record_hash;
    const entryVerification = verifyEntryHash(entry, expectedPrevHash);

    return {
      index,
      id: entry.id,
      gameId: entry.game_id,
      eventType: entry.event_type,
      createdAt: entry.created_at,
      storedRecordHash: entry.record_hash,
      storedPrevHash: entry.prev_hash,
      computedRecordHash: entryVerification.computedHash,
      hashValid: entryVerification.valid,
      prevHashValid:
        index === 0
          ? entry.prev_hash === null ||
            entry.prev_hash ===
              "0000000000000000000000000000000000000000000000000000000000000000"
          : entry.prev_hash === auditEntries[index - 1].record_hash,
    };
  });

  return {
    gameId: auditEntries.length > 0 ? auditEntries[0].game_id : null,
    valid: verification.valid,
    totalEntries: verification.totalEntries,
    tamperedIndex: verification.tamperedIndex,
    error: verification.error,
    genesisHash: verification.genesisHash,
    entries,
  };
}

module.exports = {
  canonicalAuditString,
  computeRecordHash,
  verifyMatchAuditChain,
  verifyEntryHash,
  buildChainVerificationReport,
};
