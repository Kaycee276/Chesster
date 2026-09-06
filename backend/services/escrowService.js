const { Keypair, rpc, TransactionBuilder, Networks, Contract, xdr, scValToNative, nativeToScVal } = require("@stellar/stellar-sdk");

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
async function submitWithRetry(buildOperation, { label = "coordinator transaction" } = {}) {
	if (!coordinatorKeypair) throw new Error("Coordinator secret key not configured");

	let lastErr;

	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		try {
			// Re-fetch the account fresh on every attempt: on a sequence-number
			// race the previously-read sequence is now stale.
			const sourceAccount = await server.getAccount(coordinatorKeypair.publicKey());
			const operation = buildOperation();
			const fee = await estimateFee(sourceAccount, operation);

			const tx = new TransactionBuilder(sourceAccount, {
				fee,
				networkPassphrase: NETWORK_PASSPHRASE,
			})
				.addOperation(operation)
				.setTimeout(30)
				.build();

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
				return txResponse;
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

module.exports = {
	init,
	resolveMatch,
	resolveWithWinner,
	resolveAsDraw,
	forfeitMatch,
	refundUnresolvedMatch,
	getMatch,
	estimateFee,
	isRetryableError,
	DRAW_ADDRESS,
	getHorizonTransactions,
	verifyDepositTransaction,
	createTransactionIndexer,
	validateEscrowDeposit,
};
