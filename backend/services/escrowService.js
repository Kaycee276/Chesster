const { ethers } = require("ethers");
const ESCROW_ABI = require("../abi/ChessterEscrow.json");

const RPC_URL = process.env.RPC_URL || "http://localhost:8545";
const ESCROW_ADDRESS = process.env.ESCROW_CONTRACT_ADDRESS || null;
const COORDINATOR_PRIVATE_KEY = process.env.COORDINATOR_PRIVATE_KEY;

// Special address representing a draw result
const DRAW_ADDRESS = "0x000000000000000000000000000000000000dead";

let provider, coordinatorWallet, contract;

function init() {
	provider = new ethers.JsonRpcProvider(RPC_URL);

	if (!COORDINATOR_PRIVATE_KEY) {
		console.warn("[Escrow] COORDINATOR_PRIVATE_KEY not set — operating in read-only mode");
	} else {
		coordinatorWallet = new ethers.Wallet(COORDINATOR_PRIVATE_KEY, provider);
		console.log("[Escrow] Coordinator wallet:", coordinatorWallet.address);
	}

	if (ESCROW_ADDRESS) {
		const signer = coordinatorWallet || provider;
		contract = new ethers.Contract(ESCROW_ADDRESS, ESCROW_ABI, signer);
		console.log("[Escrow] Contract connected at", ESCROW_ADDRESS);
	} else {
		console.warn("[Escrow] ESCROW_CONTRACT_ADDRESS not set — escrow disabled");
	}
}

/**
 * Convert a human-readable game code string to bytes32 via keccak256.
 * Both backend and frontend MUST use the same conversion so the key matches.
 * ethers v6: ethers.id(str) === keccak256(utf8Bytes(str))
 */
function gameCodeToBytes32(gameCode) {
	return ethers.id(gameCode); // ethers v6 — was ethers.utils.id() in v5
}

/**
 * Coordinator resolves the match (onlyCoordinator in contract).
 * Players deposit ETH directly via createMatch/joinMatch on the frontend.
 *
 * @param {string} gameCode  - Human-readable game code
 * @param {string} winner    - Player address, or DRAW_ADDRESS for a draw
 */
async function resolveMatch(gameCode, winner) {
	if (!contract) throw new Error("Escrow contract not configured");
	const gameCodeBytes32 = gameCodeToBytes32(gameCode);
	const tx = await contract.resolveMatch(gameCodeBytes32, winner);
	const receipt = await tx.wait();
	return receipt;
}

/**
 * Read match details from the contract (view call, no gas).
 */
async function getMatch(gameCode) {
	if (!contract) throw new Error("Escrow contract not configured");
	const gameCodeBytes32 = gameCodeToBytes32(gameCode);
	const m = await contract.getMatch(gameCodeBytes32);
	return {
		gameCode:    m.gameCode,
		player1:     m.player1,
		player2:     m.player2,
		wagerAmount: m.wagerAmount.toString(),
		totalStaked: m.totalStaked.toString(),
		createdAt:   Number(m.createdAt),  // BigInt → Number
		status:      Number(m.status),     // 0=PENDING 1=ACTIVE 2=RESOLVED 3=REFUNDED
		winner:      m.winner,
	};
}

/** Convenience: resolve with an explicit winner address. */
async function resolveWithWinner(gameCode, winnerAddress) {
	return resolveMatch(gameCode, winnerAddress);
}

/** Convenience: resolve as a draw (sends DRAW_ADDRESS to contract). */
async function resolveAsDraw(gameCode) {
	return resolveMatch(gameCode, DRAW_ADDRESS);
}

module.exports = {
	init,
	resolveMatch,
	resolveWithWinner,
	resolveAsDraw,
	getMatch,
	gameCodeToBytes32,
	DRAW_ADDRESS,
};
