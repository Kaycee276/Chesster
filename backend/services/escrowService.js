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
 * Coordinator creates a match, pulling wagerAmount of ERC-20 from player1.
 * Requires player1 to have already called token.approve(escrowAddress, wagerAmount).
 *
 * @param {string} gameCode        - Human-readable game code (e.g. "ABC123")
 * @param {string} player1Address  - Creator's wallet address
 * @param {string} tokenAddress    - ERC-20 token contract address
 * @param {string|number} wagerAmount - Wager in human units (parsed to 18-dec wei)
 */
async function createMatch(gameCode, player1Address, tokenAddress, wagerAmount) {
	if (!contract) throw new Error("Escrow contract not configured");
	const gameCodeBytes32 = gameCodeToBytes32(gameCode);
	const tx = await contract.createMatch(
		gameCodeBytes32,
		player1Address,
		tokenAddress,
		ethers.parseEther(wagerAmount.toString()), // ethers v6 — was ethers.utils.parseEther() in v5
	);
	const receipt = await tx.wait();
	return receipt;
}

/**
 * Coordinator joins match on behalf of player2, pulling their wager.
 * Requires player2 to have already called token.approve(escrowAddress, wagerAmount).
 *
 * @param {string} gameCode        - Human-readable game code
 * @param {string} player2Address  - Joiner's wallet address
 */
async function joinMatch(gameCode, player2Address) {
	if (!contract) throw new Error("Escrow contract not configured");
	const gameCodeBytes32 = gameCodeToBytes32(gameCode);
	const tx = await contract.joinMatch(gameCodeBytes32, player2Address);
	const receipt = await tx.wait();
	return receipt;
}

/**
 * Coordinator resolves the match (onlyCoordinator in contract).
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
	// Full ABI decodes the struct with named fields (m.player1, m.wagerAmount, etc.)
	return {
		gameCode:    m.gameCode,
		player1:     m.player1,
		player2:     m.player2,
		token:       m.token,
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
	createMatch,
	joinMatch,
	resolveMatch,
	resolveWithWinner,
	resolveAsDraw,
	getMatch,
	gameCodeToBytes32,
	DRAW_ADDRESS,
};
