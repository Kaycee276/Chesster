const { Keypair, rpc, TransactionBuilder, Networks, Contract, xdr, scValToNative, nativeToScVal } = require("@stellar/stellar-sdk");

const RPC_URL = process.env.STELLAR_RPC_URL || "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = process.env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;
const ESCROW_ADDRESS = process.env.ESCROW_CONTRACT_ADDRESS || null;
const COORDINATOR_SECRET_KEY = process.env.COORDINATOR_SECRET_KEY;

// Special address representing a draw result
const DRAW_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"; // A valid but unusable address for draw

let server, coordinatorKeypair, contract;

function init() {
	server = new rpc.Server(RPC_URL);

	if (!COORDINATOR_SECRET_KEY) {
		console.warn("[Escrow] COORDINATOR_SECRET_KEY not set — operating in read-only mode");
	} else {
		coordinatorKeypair = Keypair.fromSecret(COORDINATOR_SECRET_KEY);
		console.log("[Escrow] Coordinator wallet:", coordinatorKeypair.publicKey());
	}

	if (ESCROW_ADDRESS) {
		contract = new Contract(ESCROW_ADDRESS);
		console.log("[Escrow] Contract connected at", ESCROW_ADDRESS);
	} else {
		console.warn("[Escrow] ESCROW_CONTRACT_ADDRESS not set — escrow disabled");
	}
}

/**
 * Convert a human-readable game code string to a Soroban String scval.
 */
function gameCodeToScVal(gameCode) {
	return nativeToScVal(gameCode, { type: "string" });
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

	const sourceAccount = await server.getAccount(coordinatorKeypair.publicKey());
	
    let winnerScVal;
    if (winner === DRAW_ADDRESS) {
        winnerScVal = xdr.ScVal.scvVoid(); // Option::None
    } else {
        winnerScVal = nativeToScVal(winner, { type: "address" }); // Option::Some(Address)
    }

	const tx = new TransactionBuilder(sourceAccount, {
		fee: "10000",
		networkPassphrase: NETWORK_PASSPHRASE,
	})
		.addOperation(
			contract.call("resolve_match",
				gameCodeToScVal(gameCode),
				winnerScVal
			)
		)
		.setTimeout(30)
		.build();

    const preparedTx = await server.prepareTransaction(tx);
	preparedTx.sign(coordinatorKeypair);

	const sendResponse = await server.sendTransaction(preparedTx);
    if (sendResponse.status === "PENDING") {
        let txResponse = await server.getTransaction(sendResponse.hash);
        while (txResponse.status === "NOT_FOUND") {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            txResponse = await server.getTransaction(sendResponse.hash);
        }
        if (txResponse.status === "SUCCESS") {
            return txResponse;
        } else {
            throw new Error(`Transaction failed: ${JSON.stringify(txResponse)}`);
        }
    } else {
        throw new Error(`Transaction failed: ${JSON.stringify(sendResponse)}`);
    }
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
	getMatch,
	DRAW_ADDRESS,
	getHorizonTransactions,
	verifyDepositTransaction,
	createTransactionIndexer,
	validateEscrowDeposit,
};
