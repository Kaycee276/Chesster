const { Keypair, rpc, TransactionBuilder, Networks, Contract, Operation, Asset, Memo, xdr, scValToNative, nativeToScVal, BASE_FEE } = require("@stellar/stellar-sdk");

const RPC_URL = process.env.STELLAR_RPC_URL || "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = process.env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;
const ESCROW_ADDRESS = process.env.ESCROW_CONTRACT_ADDRESS || null;
const COORDINATOR_SECRET_KEY = process.env.COORDINATOR_SECRET_KEY;

// Special address representing a draw result
const DRAW_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"; // A valid but unusable address for draw

// ---------------------------------------------------------------------------
// Automated retry + gas estimation config (Issue #47)
//
// Coordinator transactions can fail transiently — RPC hiccups, dropped
// connections, or a sequence-number race when multiple settlements fire in
// quick succession (see gameModel._settleEscrow's own race-recovery logic,
// which this complements). Rather than let a single blip fail a payout
// outright, submission goes through exponential-backoff retry, and the
// classic transaction fee is derived per-attempt from a fresh Soroban RPC
// simulation instead of a hardcoded value.
// ---------------------------------------------------------------------------

const MAX_RETRIES = Number.isFinite(Number(process.env.COORDINATOR_TX_MAX_RETRIES))
	? Number(process.env.COORDINATOR_TX_MAX_RETRIES)
	: 5;
const BASE_RETRY_DELAY_MS = Number.isFinite(Number(process.env.COORDINATOR_TX_BASE_DELAY_MS))
	? Number(process.env.COORDINATOR_TX_BASE_DELAY_MS)
	: 500;
const MAX_RETRY_DELAY_MS = Number.isFinite(Number(process.env.COORDINATOR_TX_MAX_DELAY_MS))
	? Number(process.env.COORDINATOR_TX_MAX_DELAY_MS)
	: 15000;
const MAX_POLL_ATTEMPTS = 30; // ~30s waiting for a submitted tx to leave PENDING

// Fallback classic-tx fee (stroops) used only when simulation can't produce
// a usable resource-fee estimate (e.g. RPC temporarily unavailable). Well
// above the current testnet/mainnet base fee floor so it still lands.
const FALLBACK_FEE = "100000";
// Safety margin applied on top of the simulated resource fee so minor fee
// market fluctuations between simulation and submission don't cause an
// avoidable insufficient-fee rejection.
const FEE_SAFETY_MARGIN = 1.2;

// Maximum gas fee sponsorship allowed per user (stroops) to prevent draining coordinator funds (Issue #289)
const MAX_SPONSORSHIP_PER_USER_STROOPS = Number.isFinite(Number(process.env.MAX_SPONSORSHIP_PER_USER_STROOPS))
	? Number(process.env.MAX_SPONSORSHIP_PER_USER_STROOPS)
	: 10_000_000; // 1 XLM default cap per user

// In-memory accounting of cumulative sponsored gas fees per player address
const userSponsorshipTotals = new Map();
// In-memory audit log of fee sponsorships (replicated to match_audit_logs if Supabase available)
const matchAuditLogs = [];

let server, coordinatorKeypair, contract;

function init() {
	server = new rpc.Server(RPC_URL);

	if (!COORDINATOR_SECRET_KEY) {
		console.warn("[Escrow] COORDINATOR_SECRET_KEY not set — operating in read-only mode");
	} else {
		try {
			coordinatorKeypair = Keypair.fromSecret(COORDINATOR_SECRET_KEY);
			console.log("[Escrow] Coordinator wallet:", coordinatorKeypair.publicKey());
		} catch (err) {
			console.error("[Escrow] Invalid COORDINATOR_SECRET_KEY provided — operating in read-only mode:", err.message);
		}
	}

	if (ESCROW_ADDRESS) {
		contract = new Contract(ESCROW_ADDRESS);
		console.log("[Escrow] Contract connected at", ESCROW_ADDRESS);
	} else {
		console.warn("[Escrow] ESCROW_CONTRACT_ADDRESS not set — escrow disabled");
	}
}

function sleep(ms) {
	return new Promise((resolve) => {
		const t = setTimeout(resolve, ms);
		if (typeof t.unref === "function") t.unref(); // don't hold the process open on a pending retry
	});
}

/**
 * Convert a human-readable game code string to a Soroban String scval.
 */
function gameCodeToScVal(gameCode) {
	return nativeToScVal(gameCode, { type: "string" });
}

/**
 * Classify an error raised while submitting/polling a coordinator
 * transaction as transient (worth retrying) vs terminal (a contract-level
 * rejection or misconfiguration that will never succeed on retry).
 *
 * Covers: dropped/flaky network connections, RPC rate limiting or
 * momentary unavailability, and Stellar sequence-number races (two
 * coordinator transactions racing to submit against the same source
 * account — the classic "tx_bad_seq" horizon/RPC error).
 */
function isRetryableError(err) {
	const status = err?.response?.status ?? err?.status;
	if (status === 429 || status === 502 || status === 503 || status === 504) return true;

	const message = String(err?.message ?? err ?? "").toLowerCase();

	const retryablePatterns = [
		"econnreset",
		"econnrefused",
		"etimedout",
		"esockettimedout",
		"enotfound",
		"network error",
		"network timeout",
		"timed out",
		"socket hang up",
		"tx_bad_seq", // sequence number race
		"bad_seq",
		"txbadseq",
		"too many requests",
		"rate limit",
		"try_again_later",
		"temporarily unavailable",
		"service unavailable",
	];

	return retryablePatterns.some((pattern) => message.includes(pattern));
}

/**
 * Exponential backoff with +/-20% jitter, capped at MAX_RETRY_DELAY_MS, so
 * concurrent retries (e.g. two settlements racing) don't all wake up and
 * collide on the same schedule.
 */
function backoffDelayMs(attempt) {
	const exp = Math.min(BASE_RETRY_DELAY_MS * 2 ** attempt, MAX_RETRY_DELAY_MS);
	const jitterFactor = 0.8 + Math.random() * 0.4; // 0.8x - 1.2x
	return Math.round(exp * jitterFactor);
}

/**
 * Estimate the classic transaction fee for `operation` by simulating it
 * against current network/ledger state via Soroban RPC, instead of relying
 * on a hardcoded value. Combines the simulated Soroban resource fee with a
 * safety margin; falls back to FALLBACK_FEE if simulation is unavailable
 * or doesn't return a usable estimate (the retry loop covers the rest).
 *
 * @param {object} sourceAccount - account object from server.getAccount()
 * @param {object} operation     - a built Soroban contract-call operation
 * @returns {Promise<string>} fee in stroops, as a string (TransactionBuilder expects a string)
 */
async function estimateFee(sourceAccount, operation) {
	try {
		const probeTx = new TransactionBuilder(sourceAccount, {
			fee: FALLBACK_FEE,
			networkPassphrase: NETWORK_PASSPHRASE,
		})
			.addOperation(operation)
			.setTimeout(30)
			.build();

		const sim = await server.simulateTransaction(probeTx);

		if (sim?.error) {
			console.warn("[Escrow] Fee simulation returned an error — using fallback fee:", sim.error);
			return FALLBACK_FEE;
		}

		const resourceFee = sim?.minResourceFee;
		if (resourceFee === undefined || resourceFee === null) {
			return FALLBACK_FEE;
		}

		const withMargin = Math.ceil(Number(resourceFee) * FEE_SAFETY_MARGIN);
		if (!Number.isFinite(withMargin) || withMargin <= 0) {
			return FALLBACK_FEE;
		}

		return String(withMargin);
	} catch (err) {
		console.warn("[Escrow] Fee estimation failed — using fallback fee:", err.message);
		return FALLBACK_FEE;
	}
}

/**
 * Submit a coordinator contract-call transaction with automated retry.
 *
 * `buildOperation()` is a factory (not a pre-built operation) because each
 * retry attempt needs a fresh source-account sequence number and a fresh
 * fee estimate — reusing a signed transaction across attempts would either
 * replay a stale sequence number or double-submit.
 *
 * @param {() => object} buildOperation - returns a Soroban contract.call(...) operation
 * @param {object} [opts]
 * @param {string} [opts.label] - used only for logging
 * @returns {Promise<object>} the successful transaction response
 */
async function submitWithRetry(buildOperation, { label = "coordinator transaction", memo = null } = {}) {
	if (!coordinatorKeypair) throw new Error("Coordinator secret key not configured");

	let lastErr;

	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		try {
			// Re-fetch the account fresh on every attempt: on a sequence-number
			// race the previously-read sequence is now stale.
			const sourceAccount = await server.getAccount(coordinatorKeypair.publicKey());
			const operation = buildOperation();
			const fee = await estimateFee(sourceAccount, operation);

			const builder = new TransactionBuilder(sourceAccount, {
				fee,
				networkPassphrase: NETWORK_PASSPHRASE,
			}).addOperation(operation);
			if (memo) builder.addMemo(memo);
			const tx = builder.setTimeout(30).build();

			const preparedTx = await server.prepareTransaction(tx);
			preparedTx.sign(coordinatorKeypair);

			const sendResponse = await server.sendTransaction(preparedTx);

			if (sendResponse.status !== "PENDING") {
				throw new Error(`Transaction failed: ${JSON.stringify(sendResponse)}`);
			}

			let txResponse = await server.getTransaction(sendResponse.hash);
			let polls = 0;
			while (txResponse.status === "NOT_FOUND" && polls < MAX_POLL_ATTEMPTS) {
				await sleep(1000);
				txResponse = await server.getTransaction(sendResponse.hash);
				polls++;
			}

			if (txResponse.status === "SUCCESS") {
				if (attempt > 0) {
					console.log(`[Escrow] ${label} succeeded on retry attempt ${attempt + 1}`);
				}
				return { ...txResponse, hash: txResponse.hash || sendResponse.hash };
			}

			throw new Error(`Transaction failed: ${JSON.stringify(txResponse)}`);
		} catch (err) {
			lastErr = err;
			const retryable = isRetryableError(err);

			if (!retryable || attempt === MAX_RETRIES) {
				console.error(
					`[Escrow] ${label} failed on attempt ${attempt + 1}/${MAX_RETRIES + 1}` +
						`${retryable ? " (retries exhausted)" : " (non-retryable)"}:`,
					err.message,
				);
				throw err;
			}

			const delay = backoffDelayMs(attempt);
			console.warn(
				`[Escrow] ${label} attempt ${attempt + 1}/${MAX_RETRIES + 1} hit a transient error, ` +
					`retrying in ${delay}ms:`,
				err.message,
			);
			await sleep(delay);
		}
	}

	// Unreachable in practice (loop always returns or throws), but keeps
	// control-flow analysis happy and guards against future edits.
	throw lastErr;
}

/**
 * Coordinator resolves the match.
 *
 * @param {string} gameCode  - Human-readable game code
 * @param {string} winner    - Player address, or DRAW_ADDRESS for a draw
 */
async function resolveMatch(gameCode, winner) {
	if (!contract) throw new Error("Escrow contract not configured");
	if (!coordinatorKeypair) throw new Error("Coordinator secret key not configured");

	let winnerScVal;
	if (winner === DRAW_ADDRESS) {
		winnerScVal = xdr.ScVal.scvVoid(); // Option::None
	} else {
		winnerScVal = nativeToScVal(winner, { type: "address" }); // Option::Some(Address)
	}

	return submitWithRetry(() => contract.call("resolve_match", gameCodeToScVal(gameCode), winnerScVal), {
		label: `resolve_match(${gameCode})`,
	});
}

/**
 * Coordinator submits a verified forfeit resolution for a player who
 * disconnected and failed to reconnect within the grace period (Issue
 * #39's on-chain counterpart). Pays the wager pool to the other player via
 * the contract's dedicated `forfeit_match` entrypoint.
 *
 * @param {string} gameCode           - Human-readable game code
 * @param {string} forfeitingPlayer   - On-chain address of the disconnected player
 */
async function forfeitMatch(gameCode, forfeitingPlayer) {
	if (!contract) throw new Error("Escrow contract not configured");
	if (!coordinatorKeypair) throw new Error("Coordinator secret key not configured");

	const forfeitingScVal = nativeToScVal(forfeitingPlayer, { type: "address" });

	return submitWithRetry(() => contract.call("forfeit_match", gameCodeToScVal(gameCode), forfeitingScVal), {
		label: `forfeit_match(${gameCode})`,
	});
}

/** Refund a wager that never reached an active match (Issue #68). */
async function refundUnresolvedMatch(gameCode) {
	if (!contract) throw new Error("Escrow contract not configured");
	if (!coordinatorKeypair) throw new Error("Coordinator secret key not configured");
	return submitWithRetry(() => contract.call("refund_after_timeout", gameCodeToScVal(gameCode)), {
		label: `refund_after_timeout(${gameCode})`,
	});
}

/**
 * Read match details from the contract.
 */
async function getMatch(gameCode) {
	if (!contract) throw new Error("Escrow contract not configured");

    const tx = new TransactionBuilder(await server.getAccount(ESCROW_ADDRESS).catch(() => new rpc.Account(ESCROW_ADDRESS, "0")), {
		fee: "10000",
		networkPassphrase: NETWORK_PASSPHRASE,
	})
		.addOperation(
			contract.call("get_match", gameCodeToScVal(gameCode))
		)
		.setTimeout(30)
		.build();

    const simResponse = await server.simulateTransaction(tx);
    if (simResponse.error) {
        throw new Error(`Simulation failed: ${simResponse.error}`);
    }

    const result = scValToNative(simResponse.result.retval);

	return {
		gameCode:    result.game_code,
		player1:     result.player1,
		player2:     result.player2,
		wagerAmount: result.wager_amount.toString(),
		totalStaked: result.total_staked.toString(),
		createdAt:   Number(result.created_at),
		status:      Number(result.status),
		winner:      result.winner,
	};
}

/** Convenience: resolve with an explicit winner address. */
async function resolveWithWinner(gameCode, winnerAddress) {
	return resolveMatch(gameCode, winnerAddress);
}

/** Convenience: resolve as a draw. */
async function resolveAsDraw(gameCode) {
	return resolveMatch(gameCode, DRAW_ADDRESS);
}

/**
 * Coordinator triggers final tournament prize pool distribution.
 *
 * @param {string} tournamentId - Tournament unique identifier
 * @param {Array<string>} winners - Array of winner addresses in order of ranking
 * @param {Array<number>} [payoutBps=[10000]] - Array of payout basis points summing to 10000
 */
async function completeTournament(tournamentId, winners, payoutBps = [10000]) {
	if (!contract) throw new Error("Escrow contract not configured");
	if (!coordinatorKeypair) throw new Error("Coordinator secret key not configured");

	const winnersScVal = nativeToScVal(winners, { type: "vec" });
	const payoutBpsScVal = nativeToScVal(payoutBps, { type: "vec" });

	return submitWithRetry(
		() =>
			contract.call(
				"complete_tournament",
				nativeToScVal(tournamentId, { type: "string" }),
				winnersScVal,
				payoutBpsScVal,
			),
		{ label: `complete_tournament(${tournamentId})` },
	);
}

/**
 * Stellar Horizon Transaction Indexer for Real-Time Deposit Verification
 * Queries Horizon API to verify on-chain escrow deposit transactions
 */

const axios = require("axios");
const logger = require("../utils/logger");

const HORIZON_URL = process.env.STELLAR_HORIZON_URL || "https://horizon-testnet.stellar.org";
const PAYMENT_OPERATION_TYPE = "payment";

/**
 * Query Horizon for transactions related to a specific account
 * @param {string} accountAddress - Stellar account address
 * @returns {Array} Array of transactions
 */
async function getHorizonTransactions(accountAddress) {
	try {
		const response = await axios.get(`${HORIZON_URL}/accounts/${accountAddress}/transactions`, {
			params: {
				limit: 10,
				order: "desc"
			}
		});
		return response.data.records || [];
	} catch (error) {
		logger.error("Failed to fetch Horizon transactions", {
			account: accountAddress,
			error: error.message
		});
		return [];
	}
}

/**
 * Verify a deposit transaction hash via Horizon
 * @param {string} transactionHash - Transaction hash to verify
 * @param {string} expectedAsset - Expected asset code (or null for XLM)
 * @param {number} expectedAmount - Expected amount
 * @returns {object} Verification result
 */
async function verifyDepositTransaction(transactionHash, expectedAsset = null, expectedAmount = null) {
	try {
		logger.info("Verifying deposit transaction", {
			hash: transactionHash,
			asset: expectedAsset
		});

		const response = await axios.get(`${HORIZON_URL}/transactions/${transactionHash}`);
		const transaction = response.data;

		if (!transaction || !transaction.successful) {
			return {
				verified: false,
				reason: "Transaction not found or not successful",
				hash: transactionHash
			};
		}

		// Fetch transaction details including operations
		const operationsUrl = transaction._links.operations.href;
		const operationsResponse = await axios.get(operationsUrl);
		const operations = operationsResponse.data.records || [];

		// Find payment operations
		const paymentOps = operations.filter(op => op.type === PAYMENT_OPERATION_TYPE);

		if (paymentOps.length === 0) {
			return {
				verified: false,
				reason: "No payment operations found",
				hash: transactionHash
			};
		}

		// Verify against expected parameters
		for (const operation of paymentOps) {
			const asset = operation.asset_type === "native" ? "XLM" : operation.asset_code;
			const amount = parseFloat(operation.amount);

			const matches = {
				asset: !expectedAsset || asset === expectedAsset,
				amount: !expectedAmount || amount === expectedAmount
			};

			if (matches.asset && matches.amount) {
				logger.info("Deposit transaction verified", {
					hash: transactionHash,
					asset,
					amount,
					source: operation.from
				});

				return {
					verified: true,
					hash: transactionHash,
					asset,
					amount,
					source: operation.from,
					destination: operation.to,
					timestamp: transaction.created_at,
					ledger: transaction.ledger_attr
				};
			}
		}

		return {
			verified: false,
			reason: "Transaction details don't match expected parameters",
			hash: transactionHash
		};
	} catch (error) {
		logger.error("Error verifying deposit transaction", {
			hash: transactionHash,
			error: error.message
		});
		return {
			verified: false,
			reason: error.message,
			hash: transactionHash
		};
	}
}

/**
 * Index transactions for a player account with real-time updates
 * @param {string} playerAddress - Player's Stellar address
 * @param {function} onNewTransaction - Callback for new transactions
 * @returns {object} Indexer instance with start/stop methods
 */
function createTransactionIndexer(playerAddress, onNewTransaction) {
	let isRunning = false;
	let lastLedger = 0;
	let indexInterval = null;

	const indexer = {
		/**
		 * Start indexing transactions for the player
		 */
		async start() {
			if (isRunning) return;
			isRunning = true;
			logger.info("Starting transaction indexer", { playerAddress });

			indexInterval = setInterval(async () => {
				try {
					const transactions = await getHorizonTransactions(playerAddress);

					for (const tx of transactions) {
						const txLedger = tx.ledger_attr;
						if (txLedger > lastLedger) {
							lastLedger = txLedger;
							
							if (onNewTransaction && typeof onNewTransaction === "function") {
								const verified = await verifyDepositTransaction(tx.hash);
								if (verified.verified) {
									onNewTransaction(verified);
								}
							}
						}
					}
				} catch (error) {
					logger.error("Error during transaction indexing", { error: error.message });
				}
			}, 15000); // Check every 15 seconds
		},

		/**
		 * Stop indexing transactions
		 */
		stop() {
			if (indexInterval) {
				clearInterval(indexInterval);
				indexInterval = null;
				isRunning = false;
				logger.info("Stopped transaction indexer", { playerAddress });
			}
		},

		/**
		 * Check if indexer is running
		 */
		isRunning: () => isRunning,

		/**
		 * Manually sync transactions once
		 */
		async sync() {
			return await getHorizonTransactions(playerAddress);
		}
	};

	return indexer;
}

/**
 * Validate transaction against escrow contract deposit requirements
 * @param {object} txData - Transaction data from verifyDepositTransaction
 * @param {string} gameCode - Game code for context
 * @returns {object} Validation result
 */
async function validateEscrowDeposit(txData, gameCode) {
	try {
		if (!txData.verified) {
			return {
				valid: false,
				reason: "Transaction not verified",
				gameCode
			};
		}

		// Verify transaction is recent (within 1 hour)
		const txTime = new Date(txData.timestamp).getTime();
		const now = Date.now();
		const isRecent = (now - txTime) < (60 * 60 * 1000);

		if (!isRecent) {
			return {
				valid: false,
				reason: "Transaction is too old",
				gameCode,
				age: Math.round((now - txTime) / 1000)
			};
		}

		logger.info("Escrow deposit validated", {
			gameCode,
			source: txData.source,
			amount: txData.amount,
			asset: txData.asset
		});

		return {
			valid: true,
			gameCode,
			source: txData.source,
			amount: txData.amount,
			asset: txData.asset,
			timestamp: txData.timestamp
		};
	} catch (error) {
		logger.error("Error validating escrow deposit", {
			gameCode,
			error: error.message
		});
		return {
			valid: false,
			reason: error.message,
			gameCode
		};
	}
}

/**
 * Records sponsored gas expenditure in match_audit_logs and in-memory tracking (Issue #289).
 *
 * @param {string} gameCode - Match identifier
 * @param {string} userAddress - Player address receiving sponsorship
 * @param {number|string} feeStroops - Gas fee in stroops covered by the sponsor
 * @param {object} [extra] - Additional metadata (e.g. sponsorAddress, txHash, gameId)
 * @returns {Promise<object>} Audit log entry
 */
async function recordSponsoredGasExpenditure(gameCode, userAddress, feeStroops, extra = {}) {
	const feeNum = Number(feeStroops);
	const currentTotal = userSponsorshipTotals.get(userAddress) || 0;
	const newTotal = currentTotal + feeNum;
	userSponsorshipTotals.set(userAddress, newTotal);

	const logEntry = {
		game_code: gameCode,
		player_address: userAddress,
		event_type: "SPONSORED_GAS_EXPENDITURE",
		event_data: {
			fee_stroops: String(feeStroops),
			cumulative_user_sponsorship: String(newTotal),
			sponsor_address: extra.sponsorAddress || coordinatorKeypair?.publicKey?.(),
			...extra,
		},
		created_at: new Date().toISOString(),
	};

	matchAuditLogs.push(logEntry);

	try {
		let supabase;
		try {
			supabase = require("../config/supabase");
		} catch (e) {
			// Supabase config not provided in standalone or test environment
		}
		if (supabase && typeof supabase.from === "function") {
			await supabase.from("match_audit_logs").insert({
				game_id: extra.gameId || null,
				event_type: "SPONSORED_GAS_EXPENDITURE",
				event_data: logEntry.event_data,
				player_address: userAddress,
				coordinator_tx_hash: extra.txHash || null,
			});
		}
	} catch (err) {
		logger?.warn?.("[Escrow] Could not persist sponsored gas log to database:", err.message);
	}

	return logEntry;
}

/**
 * Builds and signs a fee bump transaction using Stellar SDK TransactionBuilder (Issue #289).
 *
 * @param {object} innerTransaction - Built and signed inner transaction
 * @param {object} [opts] - Options
 * @param {object} [opts.sponsorKeypair] - Keypair of fee sponsor (defaults to coordinatorKeypair)
 * @param {string|number} [opts.fee] - Base fee in stroops (default "200")
 * @param {string} [opts.networkPassphrase] - Network passphrase
 * @returns {object} Signed fee bump transaction
 */
function buildFeeBumpTransaction(innerTransaction, { sponsorKeypair: sponsor, fee, networkPassphrase } = {}) {
	const feeSource = sponsor || coordinatorKeypair;
	if (!feeSource) throw new Error("Coordinator/Sponsor keypair not configured");

	const passphrase = networkPassphrase || NETWORK_PASSPHRASE;
	const baseFee = fee !== undefined ? String(fee) : "200";

	const feeBumpTx = TransactionBuilder.buildFeeBumpTransaction(
		feeSource,
		baseFee,
		innerTransaction,
		passphrase
	);
	feeBumpTx.sign(feeSource);
	return feeBumpTx;
}

/**
 * Wraps an unfunded player's inner transaction in a coordinator-sponsored fee bump transaction (Issue #289).
 * Enforces per-user maximum sponsorship caps and records expenditures in match audit logs.
 *
 * @param {object} innerTransaction - Player transaction
 * @param {string} userAddress - Player address
 * @param {object} [opts]
 * @param {string|number} [opts.fee] - Fee in stroops (default "200")
 * @param {string} [opts.gameCode] - Game code identifier
 * @param {object} [opts.sponsorKeypair] - Custom sponsor keypair
 * @param {string} [opts.gameId] - Database UUID of game
 * @returns {Promise<object>} Signed fee bump transaction
 */
async function sponsorTransaction(innerTransaction, userAddress, { fee = "200", gameCode, sponsorKeypair: sponsor, gameId } = {}) {
	if (!userAddress) throw new Error("User address required for fee sponsorship");
	const feeStroops = Number(fee);
	if (!Number.isFinite(feeStroops) || feeStroops <= 0) {
		throw new Error("Invalid fee stroops for fee sponsorship");
	}

	const currentTotal = userSponsorshipTotals.get(userAddress) || 0;
	if (currentTotal + feeStroops > MAX_SPONSORSHIP_PER_USER_STROOPS) {
		throw new Error(`Sponsorship cap of ${MAX_SPONSORSHIP_PER_USER_STROOPS} stroops exceeded for user ${userAddress}`);
	}

	const feeBumpTx = buildFeeBumpTransaction(innerTransaction, {
		sponsorKeypair: sponsor,
		fee: String(feeStroops),
	});

	await recordSponsoredGasExpenditure(gameCode, userAddress, feeStroops, {
		sponsorAddress: (sponsor || coordinatorKeypair)?.publicKey?.(),
		gameId,
	});

	return feeBumpTx;
}

/**
 * Returns cumulative sponsored gas expenditures in stroops for a user (Issue #289).
 */
function getUserSponsorshipTotal(userAddress) {
	return userSponsorshipTotals.get(userAddress) || 0;
}

/**
 * Returns match audit logs for a game code or all logs (Issue #289).
 */
function getMatchAuditLogs(gameCode) {
	if (gameCode) {
		return matchAuditLogs.filter((l) => l.game_code === gameCode);
	}
	return [...matchAuditLogs];
}

/**
 * Resets user sponsorship counters and audit logs (useful for testing) (Issue #289).
 */
function resetUserSponsorship(userAddress) {
	if (userAddress) {
		userSponsorshipTotals.delete(userAddress);
	} else {
		userSponsorshipTotals.clear();
		matchAuditLogs.length = 0;
	}
}

/**
 * Wraps an async function with a renewable Redis lock (Issue #703).
 * Acquires a lock before executing the function and extends the TTL periodically
 * while the function is running. This prevents deadlocks when settlement takes longer
 * than the initial TTL, which can happen during high Stellar network congestion.
 *
 * @param {object} redis - Redis client instance
 * @param {string} lockKey - Redis key for the lock (e.g., "lock:escrow:match:ABC123")
 * @param {string} workerId - Unique identifier for this worker/process
 * @param {number} ttlSeconds - Lock TTL in seconds
 * @param {function} fn - Async function to execute within the lock
 * @returns {Promise<any>} Result of fn()
 * @throws {Error} If lock acquisition fails or fn() throws
 */
async function withRenewableLock(redis, lockKey, workerId, ttlSeconds, fn) {
	if (!redis || !lockKey || !workerId || !ttlSeconds || typeof fn !== 'function') {
		throw new Error('withRenewableLock: missing required arguments');
	}

	const acquired = await redis.set(lockKey, workerId, 'NX', 'EX', ttlSeconds);
	if (!acquired) {
		throw new Error(`Failed to acquire lock: ${lockKey}`);
	}

	const renewalIntervalMs = Math.floor((ttlSeconds / 3) * 1000);
	let renewalInterval = null;
	let result;

	try {
		renewalInterval = setInterval(async () => {
			try {
				await redis.expire(lockKey, ttlSeconds);
			} catch (err) {
				console.error(`[Escrow] Lock renewal failed for ${lockKey}:`, err.message);
				if (renewalInterval) {
					clearInterval(renewalInterval);
					renewalInterval = null;
				}
			}
		}, renewalIntervalMs);

		result = await fn();
		return result;
	} finally {
		if (renewalInterval) {
			clearInterval(renewalInterval);
			renewalInterval = null;
		}
		await releaseLockSafe(redis, lockKey, workerId);
	}
}

/**
 * Safely releases a lock only if the current holder (workerId) matches.
 * Uses a Lua script for atomicity.
 *
 * @param {object} redis - Redis client instance
 * @param {string} lockKey - Redis key for the lock
 * @param {string} workerId - Expected lock holder
 */
async function releaseLockSafe(redis, lockKey, workerId) {
	const luaScript = `
		if redis.call('GET', KEYS[1]) == ARGV[1] then
			return redis.call('DEL', KEYS[1])
		else
			return 0
		end
	`;
	try {
		await redis.eval(luaScript, 1, lockKey, workerId);
	} catch (err) {
		console.error(`[Escrow] Safe lock release failed for ${lockKey}:`, err.message);
	}
}

// ---------------------------------------------------------------------------
// Idempotent settlement coordinator (Issue #645)
//
// Concurrent game-end events (resignation + flag fall, tournament rounds
// finishing together) can race to settle the same match. Settlement is
// therefore serialised per match id and recorded in a ledger so it can only
// ever be submitted once:
//
//   1. Redis mutex  lock:escrow:match:<id>  (SET NX, 30s TTL, renewed while held)
//   2. escrow_settlement_ledger lookup      (already confirmed -> return it)
//   3. Soroban RPC status pre-check         (only an Active match is settled)
//   4. pending ledger row, then submission  (txBAD_SEQ retried with backoff in
//                                            submitWithRetry)
//   5. optimistic-lock ledger update to confirmed / failed, retried with
//      exponential backoff and jitter via database/transactionRetry
// ---------------------------------------------------------------------------

const { executeWithRetry, OptimisticLockError } = require("../database/transactionRetry");

const ON_CHAIN_STATUS = Object.freeze({ PENDING: 0, ACTIVE: 1, RESOLVED: 2, REFUNDED: 3 });
const SETTLEMENT_LOCK_TTL_SECONDS = 30;
const SETTLEMENT_LEDGER_TABLE = "escrow_settlement_ledger";

class SettlementInProgressError extends Error {
	constructor(matchId) {
		super(`Settlement already in progress for match ${matchId}`);
		this.name = "SettlementInProgressError";
		this.code = "SETTLEMENT_IN_PROGRESS";
		this.matchId = matchId;
	}
}

class MatchNotActiveError extends Error {
	constructor(matchId, status) {
		super(`Match ${matchId} cannot be settled: on-chain status is ${status}`);
		this.name = "MatchNotActiveError";
		this.code = "MATCH_NOT_ACTIVE";
		this.matchId = matchId;
		this.status = status;
	}
}

/**
 * Read the match status from the escrow contract via Soroban RPC (get_match
 * simulation) so settlement is only attempted for an Active match.
 * @returns {Promise<{status: number, exists: boolean, isActive: boolean, isFinal: boolean, match: object}>}
 */
async function checkOnChainStatus(matchId) {
	const match = await getMatch(matchId);
	const status = Number(match.status);
	const exists = match.createdAt !== 0;
	return {
		status,
		exists,
		isActive: exists && status === ON_CHAIN_STATUS.ACTIVE,
		isFinal: exists && (status === ON_CHAIN_STATUS.RESOLVED || status === ON_CHAIN_STATUS.REFUNDED),
		match,
	};
}

/** In-memory ledger with the same contract as the database one (tests, standalone use). */
function createMemoryLedger() {
	const rows = new Map();
	return {
		async find(matchId) {
			const row = rows.get(String(matchId));
			return row ? { ...row } : null;
		},
		async insertPending(matchId) {
			const id = String(matchId);
			if (rows.has(id)) return null;
			const row = { match_id: id, status: "pending", tx_hash: null, attempts: 1, last_error: null, version: 0, submitted_at: new Date().toISOString() };
			rows.set(id, row);
			return { ...row };
		},
		async update(matchId, expectedVersion, patch) {
			const row = rows.get(String(matchId));
			if (!row || row.version !== expectedVersion) throw new OptimisticLockError();
			Object.assign(row, patch, { version: expectedVersion + 1 });
			return { ...row };
		},
	};
}

/** Ledger backed by the escrow_settlement_ledger PostgreSQL table (via the Supabase client). */
function createSupabaseLedger(supabase) {
	return {
		async find(matchId) {
			const { data, error } = await supabase.from(SETTLEMENT_LEDGER_TABLE).select("*").eq("match_id", String(matchId)).maybeSingle();
			if (error) throw error;
			return data || null;
		},
		async insertPending(matchId) {
			const { data, error } = await supabase
				.from(SETTLEMENT_LEDGER_TABLE)
				.insert({ match_id: String(matchId), status: "pending" })
				.select()
				.single();
			if (error) {
				if (error.code === "23505") return null; // unique violation: another settlement owns this match
				throw error;
			}
			return data;
		},
		async update(matchId, expectedVersion, patch) {
			const { data, error } = await supabase
				.from(SETTLEMENT_LEDGER_TABLE)
				.update({ ...patch, version: expectedVersion + 1, updated_at: new Date().toISOString() })
				.eq("match_id", String(matchId))
				.eq("version", expectedVersion)
				.select();
			if (error) throw error;
			if (!data || data.length === 0) throw new OptimisticLockError();
			return data[0];
		},
	};
}

let defaultMemoryLedger = null;

function resolveDefaultLedger() {
	try {
		const supabase = require("../config/supabase");
		if (supabase && typeof supabase.from === "function") return createSupabaseLedger(supabase);
	} catch (_) {
		// Supabase not configured (standalone or test environment)
	}
	if (!defaultMemoryLedger) {
		console.warn("[Escrow] Database unavailable — settlement ledger is in-memory and only protects this process");
		defaultMemoryLedger = createMemoryLedger();
	}
	return defaultMemoryLedger;
}

function resolveDefaultRedis() {
	try {
		return require("../config/redis").getRedisClient();
	} catch (_) {
		return null;
	}
}

// Fallback mutual exclusion for deployments without Redis (single process only).
const inProcessSettlementLocks = new Set();

async function withSettlementLock(matchId, { redis, workerId, ttlSeconds }, fn) {
	const lockKey = `lock:escrow:match:${matchId}`;

	if (!redis) {
		if (inProcessSettlementLocks.has(lockKey)) throw new SettlementInProgressError(matchId);
		inProcessSettlementLocks.add(lockKey);
		try {
			return await fn();
		} finally {
			inProcessSettlementLocks.delete(lockKey);
		}
	}

	let entered = false;
	try {
		return await withRenewableLock(redis, lockKey, workerId, ttlSeconds, async () => {
			entered = true;
			return fn();
		});
	} catch (err) {
		if (!entered && String(err?.message).startsWith("Failed to acquire lock")) throw new SettlementInProgressError(matchId);
		throw err;
	}
}

/** Optimistic-lock ledger update: re-reads the row and retries with backoff + jitter on conflict. */
async function updateSettlementLedger(ledger, matchId, buildPatch, retryOptions = {}) {
	return executeWithRetry(
		async () => {
			const current = await ledger.find(matchId);
			if (!current) throw new Error(`Settlement ledger row missing for match ${matchId}`);
			const patch = typeof buildPatch === "function" ? buildPatch(current) : buildPatch;
			return ledger.update(matchId, current.version, patch);
		},
		{ maxRetries: 5, baseDelayMs: 25, maxDelayMs: 500, context: `escrow-ledger:${matchId}`, ...retryOptions },
	);
}

/**
 * Settle a match exactly once, however many callers race to do it.
 *
 * @param {string} matchId - game code / on-chain match id
 * @param {() => Promise<{hash?: string}>} settlementFn - performs the on-chain
 *   resolve/refund (e.g. () => resolveWithWinner(code, winner)) and returns its receipt
 * @param {object} [options]
 * @param {object} [options.redis] - Redis client (defaults to the shared client; in-process lock without one)
 * @param {object} [options.ledger] - ledger store (defaults to the escrow_settlement_ledger table)
 * @param {Function} [options.checkStatus] - on-chain status lookup (defaults to checkOnChainStatus)
 * @param {string} [options.workerId] - lock owner id
 * @param {number} [options.lockTtlSeconds=30]
 * @param {object} [options.retry] - overrides for the ledger update retry (see executeWithRetry)
 * @returns {Promise<{matchId: string, status: string, txHash: string|null, idempotent: boolean,
 *   alreadySettled: boolean, onChainStatus?: number, receipt?: object}>}
 * @throws {SettlementInProgressError} another settlement for this match holds the lock
 * @throws {MatchNotActiveError} the match is not Active on-chain and was never settled
 */
async function settleMatchWithIdempotency(matchId, settlementFn, options = {}) {
	if (!matchId) throw new Error("matchId is required for settlement");
	if (typeof settlementFn !== "function") throw new Error("settlementFn must be a function");

	const redis = options.redis === undefined ? resolveDefaultRedis() : options.redis;
	const ledger = options.ledger || resolveDefaultLedger();
	const checkStatus = options.checkStatus || checkOnChainStatus;
	const workerId = options.workerId || `escrow-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
	const ttlSeconds = options.lockTtlSeconds || SETTLEMENT_LOCK_TTL_SECONDS;

	return withSettlementLock(matchId, { redis, workerId, ttlSeconds }, async () => {
		// 1. Idempotency: a confirmed settlement is returned as-is.
		let record = await ledger.find(matchId);
		if (record && record.status === "confirmed") {
			return { matchId, status: "confirmed", txHash: record.tx_hash || null, idempotent: true, alreadySettled: true };
		}

		// 2. Only an Active match can be settled; anything already final on-chain
		//    (e.g. settled by a crashed worker whose ledger write was lost) is reconciled.
		const chain = await checkStatus(matchId);
		if (!chain.isActive) {
			if (!chain.isFinal) throw new MatchNotActiveError(matchId, chain.status);
			if (!record) {
				record = await ledger.insertPending(matchId);
				if (!record) throw new SettlementInProgressError(matchId);
			}
			await updateSettlementLedger(ledger, matchId, { status: "confirmed", last_error: null }, options.retry);
			return { matchId, status: "confirmed", txHash: record.tx_hash || null, idempotent: true, alreadySettled: true, onChainStatus: chain.status };
		}

		// 3. Record the attempt before touching the network so a duplicate cannot start.
		if (!record) {
			record = await ledger.insertPending(matchId);
			if (!record) throw new SettlementInProgressError(matchId);
		} else {
			await updateSettlementLedger(
				ledger,
				matchId,
				(current) => ({ status: "pending", attempts: (current.attempts || 0) + 1, submitted_at: new Date().toISOString(), last_error: null }),
				options.retry,
			);
		}

		// 4. Submit. txBAD_SEQ and other transient failures are retried with
		//    exponential backoff + jitter inside submitWithRetry.
		let receipt;
		try {
			receipt = await settlementFn();
		} catch (err) {
			try {
				await updateSettlementLedger(ledger, matchId, { status: "failed", last_error: String(err?.message || err).slice(0, 500) }, options.retry);
			} catch (ledgerErr) {
				console.error(`[Escrow] Could not mark settlement failed for ${matchId}:`, ledgerErr.message);
			}
			throw err;
		}

		// 5. Confirm. The transaction is already on-chain, so a ledger write
		//    failure must not hide the receipt from the caller.
		const txHash = receipt?.hash || null;
		try {
			await updateSettlementLedger(ledger, matchId, { status: "confirmed", tx_hash: txHash, last_error: null }, options.retry);
		} catch (ledgerErr) {
			console.error(`[Escrow] Settlement ${matchId} confirmed on-chain (${txHash}) but ledger update failed:`, ledgerErr.message);
		}
		return { matchId, status: "confirmed", txHash, idempotent: false, alreadySettled: false, receipt };
	});
}

// Serializes coordinator classic payments so concurrent refund batches never
// race on the same Stellar sequence number (sequence-number lock).
let paymentLock = Promise.resolve();

function withSequenceLock(task) {
	const run = paymentLock.then(task, task);
	paymentLock = run.catch(() => undefined);
	return run;
}

/**
 * Refund a tournament buy-in to a single participant with a native payment
 * from the coordinator account. Calls are serialized behind a sequence lock.
 *
 * @param {string} tournamentId
 * @param {string} destination - participant Stellar address
 * @param {string|number} amount - XLM amount
 * @returns {Promise<{hash: string}>}
 */
async function refundTournamentBuyIn(tournamentId, destination, amount) {
	if (!coordinatorKeypair) throw new Error("Coordinator secret key not configured");
	if (!destination) throw new Error("Refund destination is required");
	if (!(Number(amount) > 0)) throw new Error("Refund amount must be positive");
	const memo = Memo.text(`refund:${String(tournamentId).slice(0, 20)}`);
	return withSequenceLock(async () => {
		const response = await submitWithRetry(
			() => Operation.payment({ destination, asset: Asset.native(), amount: String(amount) }),
			{ label: `tournament_refund(${tournamentId}, ${destination})`, memo },
		);
		return { hash: response.hash || response.txHash || response.id };
	});
}

/**
 * Refund a list of participants in concurrent batches. Never throws for an
 * individual failure; each result carries its own outcome.
 */
async function refundTournamentBatch(tournamentId, entries, { batchSize = 5 } = {}) {
	const results = [];
	for (let i = 0; i < entries.length; i += batchSize) {
		const batch = entries.slice(i, i + batchSize);
		const settled = await Promise.allSettled(
			batch.map((e) => refundTournamentBuyIn(tournamentId, e.wallet_address, e.amount)),
		);
		settled.forEach((r, idx) => {
			results.push(
				r.status === "fulfilled"
					? { wallet_address: batch[idx].wallet_address, ok: true, hash: r.value.hash }
					: { wallet_address: batch[idx].wallet_address, ok: false, error: r.reason?.message || String(r.reason) },
			);
		});
	}
	return results;
/**
 * Enqueue a failed escrow transaction intent for dead-letter retry processing.
 *
 * @param {object} item - { matchId, action, winner, attempts, lastError, ... }
 * @param {object} [customRedis] - Optional injected redis client
 * @returns {Promise<boolean>} whether enqueueing succeeded
 */
async function enqueueEscrowRetry(item, customRedis = null) {
	try {
		const { getRedisClient } = require("../config/redis");
		const redis = customRedis || getRedisClient();
		if (!redis || typeof redis.rpush !== "function") {
			console.warn(`[Escrow] Redis unavailable, cannot enqueue retry for match: ${item?.matchId}`);
			return false;
		}
		const payload = JSON.stringify({
			...item,
			attempts: item.attempts || 0,
			enqueuedAt: Date.now(),
		});
		await redis.rpush("queue:escrow:retry", payload);
		console.log(`[Escrow] Successfully enqueued retry for match ${item?.matchId}`);
		return true;
	} catch (err) {
		console.error(`[Escrow] Failed to enqueue retry for match ${item?.matchId}:`, err.message);
		return false;
	}
}

module.exports = {
	init,
	refundTournamentBuyIn,
	refundTournamentBatch,
	resolveMatch,
	resolveWithWinner,
	resolveAsDraw,
	completeTournament,
	forfeitMatch,
	refundUnresolvedMatch,
	getMatch,
	estimateFee,
	isRetryableError,
	enqueueEscrowRetry,
	DRAW_ADDRESS,
	getHorizonTransactions,
	verifyDepositTransaction,
	createTransactionIndexer,
	validateEscrowDeposit,
	MAX_SPONSORSHIP_PER_USER_STROOPS,
	buildFeeBumpTransaction,
	sponsorTransaction,
	recordSponsoredGasExpenditure,
	getUserSponsorshipTotal,
	getMatchAuditLogs,
	resetUserSponsorship,
	withRenewableLock,
	releaseLockSafe,
	settleMatchWithIdempotency,
	checkOnChainStatus,
	createMemoryLedger,
	createSupabaseLedger,
	SettlementInProgressError,
	MatchNotActiveError,
	ON_CHAIN_STATUS,
	SETTLEMENT_LOCK_TTL_SECONDS,
};
