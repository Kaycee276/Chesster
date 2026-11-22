const { Keypair, rpc } = require("@stellar/stellar-sdk");
const escrowService = require("../services/escrowService");
const supabase = require("../config/supabase");
const { getRedisClient } = require("../config/redis");

const QUEUE_ESCROW_RETRY = "queue:escrow:retry";
const QUEUE_ESCROW_DEAD = "queue:escrow:dead";
const MAX_ATTEMPTS = 5;

// Exponential backoff schedule (ms): 5s, 15s, 45s, 2m, 5m
const RETRY_BACKOFF_SCHEDULE = [5000, 15000, 45000, 120000, 300000];

function calculateBackoffDelay(attempt) {
	const base = RETRY_BACKOFF_SCHEDULE[Math.min(attempt, RETRY_BACKOFF_SCHEDULE.length - 1)];
	const jitter = 0.8 + Math.random() * 0.4; // +/- 20% jitter
	return Math.round(base * jitter);
}

function isRetryableError(err) {
	if (typeof escrowService.isRetryableError === "function") {
		return escrowService.isRetryableError(err);
	}
	const status = err?.response?.status ?? err?.status;
	if (status === 429 || status === 502 || status === 503 || status === 504) return true;
	const msg = String(err?.message ?? err ?? "").toLowerCase();
	return (
		msg.includes("tx_bad_seq") ||
		msg.includes("bad_seq") ||
		msg.includes("timeout") ||
		msg.includes("timed out") ||
		msg.includes("rate limit") ||
		msg.includes("econnreset") ||
		msg.includes("network")
	);
}

async function notifyMaintainerAlert(matchId, message) {
	console.error(`[HIGH-PRIORITY ALERT] Escrow failure for match ${matchId}: ${message}`);
}

async function queryOnChainMatchState(matchId) {
	try {
		return await escrowService.getMatch(matchId);
	} catch (err) {
		return null;
	}
}

/**
 * Process a single escrow retry item from the queue.
 *
 * @param {object} item - Queued retry payload: { matchId, action, winner, attempts, ... }
 * @param {object} redisClient - Redis client instance
 * @param {object} [horizonServer] - Optional custom Horizon/RPC server
 * @returns {Promise<object>} Outcome of the retry operation
 */
async function processEscrowRetry(item, redisClient, horizonServer) {
	const { matchId, action, attempts = 0 } = item;

	// 1. Idempotency probe: has the contract already settled this match?
	const onChainMatch = await queryOnChainMatchState(matchId);
	if (
		onChainMatch &&
		(onChainMatch.status === 2 ||
			onChainMatch.status === 3 ||
			onChainMatch.status === "SETTLED" ||
			onChainMatch.status === "RESOLVED" ||
			onChainMatch.status === "CANCELLED" ||
			onChainMatch.status === "REFUNDED")
	) {
		console.log(`[EscrowWorker] Match ${matchId} already completed on-chain. Clearing retry.`);
		return { success: true, alreadySettled: true };
	}

	// 2. Threshold check: exceeded 5 attempts
	if (attempts >= MAX_ATTEMPTS) {
		if (redisClient && typeof redisClient.rpush === "function") {
			await redisClient.rpush(
				QUEUE_ESCROW_DEAD,
				JSON.stringify({ ...item, failedAt: Date.now(), error: "Exhausted 5 settlement retries" })
			);
		}
		await notifyMaintainerAlert(matchId, "Exhausted 5 settlement retries");
		try {
			await supabase.from("games").update({ escrow_status: "ESCALATED_MANUAL_REVIEW" }).eq("game_code", matchId);
		} catch (_) {}
		return { success: false, exhausted: true };
	}

	// 3. Re-submit transaction with refreshed sequence number
	try {
		let receipt;
		if (action === "refund" || action === "refund_after_timeout") {
			receipt = await escrowService.refundUnresolvedMatch(matchId);
		} else if (action === "forfeit" && item.forfeitingAddress) {
			receipt = await escrowService.forfeitMatch(matchId, item.forfeitingAddress);
		} else if (item.winner === "draw") {
			receipt = typeof escrowService.resolveAsDraw === "function"
				? await escrowService.resolveAsDraw(matchId)
				: await escrowService.resolveMatch(matchId, "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");
		} else {
			receipt = typeof escrowService.resolveWithWinner === "function"
				? await escrowService.resolveWithWinner(matchId, item.winnerAddress || item.winner)
				: await escrowService.resolveMatch(matchId, item.winnerAddress || item.winner);
		}

		try {
			await supabase.from("games").update({ escrow_status: "settled", escrow_resolve_tx: receipt?.hash }).eq("game_code", matchId);
		} catch (_) {}

		console.log(`[EscrowWorker] Recovered settlement for ${matchId} on retry attempt ${attempts + 1}`);
		return { success: true, receipt };
	} catch (err) {
		const retryable = isRetryableError(err);
		const newAttempts = attempts + 1;

		if (!retryable || newAttempts >= MAX_ATTEMPTS) {
			if (redisClient && typeof redisClient.rpush === "function") {
				await redisClient.rpush(
					QUEUE_ESCROW_DEAD,
					JSON.stringify({
						...item,
						attempts: newAttempts,
						failedAt: Date.now(),
						error: err.message,
						terminal: !retryable,
					})
				);
			}
			await notifyMaintainerAlert(
				matchId,
				!retryable ? `Terminal escrow failure: ${err.message}` : `Exhausted 5 settlement retries: ${err.message}`
			);
			try {
				await supabase.from("games").update({ escrow_status: "ESCALATED_MANUAL_REVIEW" }).eq("game_code", matchId);
			} catch (_) {}
			return {
				success: false,
				terminal: !retryable,
				exhausted: newAttempts >= MAX_ATTEMPTS,
				error: err.message,
			};
		}

		// Enqueue for next retry
		const nextItem = {
			...item,
			attempts: newAttempts,
			lastError: err.message,
			nextRetryAt: Date.now() + calculateBackoffDelay(newAttempts),
		};

		if (redisClient && typeof redisClient.rpush === "function") {
			await redisClient.rpush(QUEUE_ESCROW_RETRY, JSON.stringify(nextItem));
		}

		return { success: false, retryScheduled: true, attempts: newAttempts };
	}
}

let isWorkerRunning = false;

async function startEscrowDeadLetterWorker({ redisClient = null, pollIntervalMs = 5000 } = {}) {
	isWorkerRunning = true;
	const redis = redisClient || getRedisClient();

	while (isWorkerRunning) {
		try {
			if (redis && typeof redis.lpop === "function") {
				const raw = await redis.lpop(QUEUE_ESCROW_RETRY);
				if (raw) {
					const item = typeof raw === "string" ? JSON.parse(raw) : raw;
					if (!item.nextRetryAt || Date.now() >= item.nextRetryAt) {
						await processEscrowRetry(item, redis);
					} else {
						// Put it back if backoff delay hasn't passed
						await redis.rpush(QUEUE_ESCROW_RETRY, JSON.stringify(item));
					}
				}
			}
		} catch (workerErr) {
			console.error("[EscrowWorker] Worker loop error:", workerErr.message);
		}
		await new Promise((r) => setTimeout(r, pollIntervalMs));
	}
}

function stopEscrowDeadLetterWorker() {
	isWorkerRunning = false;
}

module.exports = {
	processEscrowRetry,
	isRetryableError,
	notifyMaintainerAlert,
	queryOnChainMatchState,
	calculateBackoffDelay,
	startEscrowDeadLetterWorker,
	stopEscrowDeadLetterWorker,
	QUEUE_ESCROW_RETRY,
	QUEUE_ESCROW_DEAD,
	MAX_ATTEMPTS,
	RETRY_BACKOFF_SCHEDULE,
};
