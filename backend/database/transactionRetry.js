const logger = require("../utils/logger");

/**
 * Optimistic locking failure: a conditional `WHERE version = $currentVersion`
 * update matched 0 rows because another worker already incremented it (#472).
 */
class OptimisticLockError extends Error {
	constructor(message = "Optimistic lock conflict: record was modified concurrently") {
		super(message);
		this.name = "OptimisticLockError";
		this.code = "OPTIMISTIC_LOCK";
	}
}

function isOptimisticLockError(error) {
	if (!error) return false;
	if (error instanceof OptimisticLockError) return true;
	if (String(error.code || "") === "OPTIMISTIC_LOCK") return true;
	if (error.name === "OptimisticLockError") return true;
	const message = String(error.message || "").toLowerCase();
	return (
		message.includes("optimistic lock") ||
		message.includes("version mismatch") ||
		message.includes("concurrent modification")
	);
}

/**
 * Transient error detection:
 * - PostgreSQL error 40P01: deadlock detected
 * - PostgreSQL error 40001: serialization failure
 * - Prisma error P2034: transaction failed due to a write conflict or a deadlock
 * - String matches for write conflict or deadlock
 */
function isTransientConflictError(error) {
	if (!error) return false;
	// Optimistic-lock collisions are retryable by definition (#472).
	if (isOptimisticLockError(error)) return true;
	const code = String(error.code || error.sqlState || "");
	if (code === "40P01" || code === "40001" || code === "P2034") {
		return true;
	}

	const message = String(error.message || "").toLowerCase();
	return (
		message.includes("deadlock detected") ||
		message.includes("deadlock") ||
		message.includes("could not serialize access") ||
		message.includes("serialization failure") ||
		message.includes("write conflict") ||
		message.includes("transaction failed due to a write conflict")
	);
}

/**
 * Executes a database transaction callback with automated exponential backoff
 * and randomized full jitter on transient deadlock or write conflict errors.
 *
 * @param {Function} prismaTransactionFn - Async callback returning the transaction promise
 * @param {number|object} [optionsOrMaxRetries=5] - maxRetries number or configuration options object
 * @param {number} [baseDelay=100] - Base delay in milliseconds
 * @returns {Promise<*>} Result of the transaction callback
 */
async function executeWithRetry(prismaTransactionFn, optionsOrMaxRetries = 5, baseDelay = 100) {
	let maxRetries = 5;
	let baseDelayMs = 100;
	let context = "tournament-transaction";
	let onRetry = null;
	let sleepFn = null;

	if (typeof optionsOrMaxRetries === "object" && optionsOrMaxRetries !== null) {
		maxRetries = optionsOrMaxRetries.maxRetries ?? 5;
		baseDelayMs = optionsOrMaxRetries.baseDelayMs ?? optionsOrMaxRetries.baseDelay ?? 100;
		context = optionsOrMaxRetries.context ?? "tournament-transaction";
		onRetry = optionsOrMaxRetries.onRetry ?? null;
		sleepFn = optionsOrMaxRetries.sleepFn ?? null;
	} else if (typeof optionsOrMaxRetries === "number") {
		maxRetries = optionsOrMaxRetries;
		if (typeof baseDelay === "number") baseDelayMs = baseDelay;
	}

	let attempt = 0;
	while (attempt < maxRetries) {
		try {
			return await prismaTransactionFn();
		} catch (error) {
			attempt++;
			const isDeadlock = isTransientConflictError(error);

			if (!isDeadlock || attempt >= maxRetries) {
				if (isDeadlock) {
					logger.error(`[TransactionRetry] Exceeded maximum retries (${maxRetries}) for ${context}:`, {
						error: error.message,
						code: error.code,
						attempt,
					});
				}
				throw error;
			}

			// Full jitter backoff formula: sleep(Math.random() * (baseDelayMs * 2 ** attempt))
			const maxWindow = baseDelayMs * Math.pow(2, attempt);
			const delay = Math.floor(Math.random() * maxWindow);

			logger.warn(
				`[TransactionRetry] Transient conflict (${error.code || error.message}) during ${context} on attempt ${attempt}/${maxRetries}. Retrying in ${delay}ms...`,
				{
					context,
					attempt,
					maxRetries,
					delay,
					errorCode: error.code,
				}
			);

			if (typeof onRetry === "function") {
				onRetry({ error, attempt, maxRetries, delay, context });
			}

			if (typeof sleepFn === "function") {
				await sleepFn(delay);
			} else {
				await new Promise((resolve) => setTimeout(resolve, delay));
			}
		}
	}
}

module.exports = {
	executeWithRetry,
	isTransientConflictError,
	isOptimisticLockError,
	OptimisticLockError,
};
