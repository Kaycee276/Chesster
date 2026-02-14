const { ethers } = require("ethers");

const RPC_URL = process.env.RPC_URL || "http://localhost:8545";
const ESCROW_ADDRESS = process.env.ESCROW_CONTRACT_ADDRESS || null;
const COORDINATOR_PRIVATE_KEY = process.env.COORDINATOR_PRIVATE_KEY;

const ESCROW_ABI = [
  "function createMatch(bytes32 gameCode, address token, uint256 wagerAmount)",
  "function joinMatch(bytes32 gameCode)",
  "function resolveMatch(bytes32 gameCode, address winner)",
  "function refundAfterTimeout(bytes32 gameCode)",
  "function getMatch(bytes32 gameCode) view returns ((bytes32, address, address, address, uint256, uint256, uint256, uint8, address))",
  "event MatchCreated(bytes32 indexed gameCode, address indexed creator, address indexed token, uint256 wagerAmount)",
  "event PlayerJoined(bytes32 indexed gameCode, address indexed joiner, uint256 wagerAmount)",
  "event MatchResolved(bytes32 indexed gameCode, address indexed winner, uint256 payout)",
  "event DrawResolved(bytes32 indexed gameCode, address indexed player1, address indexed player2, uint256 refundAmount)",
];

const DRAW_ADDRESS = "0x000000000000000000000000000000000000dead";

let provider, coordinatorWallet, contract;

function init() {
  provider = new ethers.providers.JsonRpcProvider(RPC_URL);

  if (!COORDINATOR_PRIVATE_KEY) {
    console.warn("No COORDINATOR_PRIVATE_KEY, read-only mode");
  } else {
    coordinatorWallet = new ethers.Wallet(COORDINATOR_PRIVATE_KEY, provider);
  }

  if (ESCROW_ADDRESS) {
    const signer = coordinatorWallet || provider;
    contract = new ethers.Contract(ESCROW_ADDRESS, ESCROW_ABI, signer);
  }
}

/**
 * Convert gameCode string to bytes32 hash
 */
function gameCodeToBytes32(gameCode) {
  return ethers.utils.id(gameCode);
}

/**
 * Creator initiates match with wager
 */
async function createMatch(gameCode, tokenAddress, wagerAmount) {
  if (!contract) throw new Error("Escrow contract not configured");
  const gameCodeBytes32 = gameCodeToBytes32(gameCode);
  const tx = await contract.createMatch(
    gameCodeBytes32,
    tokenAddress,
    ethers.utils.parseEther(wagerAmount.toString())
  );
  const receipt = await tx.wait();
  return receipt;
}

/**
 * Joiner joins match with same wager
 */
async function joinMatch(gameCode) {
  if (!contract) throw new Error("Escrow contract not configured");
  const gameCodeBytes32 = gameCodeToBytes32(gameCode);
  const tx = await contract.joinMatch(gameCodeBytes32);
  const receipt = await tx.wait();
  return receipt;
}

/**
 * Coordinator resolves match with winner (address or DRAW_ADDRESS for draw)
 */
async function resolveMatch(gameCode, winner) {
  if (!contract) throw new Error("Escrow contract not configured");
  const gameCodeBytes32 = gameCodeToBytes32(gameCode);
  // winner can be: player address or DRAW_ADDRESS
  const tx = await contract.resolveMatch(gameCodeBytes32, winner);
  const receipt = await tx.wait();
  return receipt;
}

/**
 * Get match details from contract
 */
async function getMatch(gameCode) {
  if (!contract) throw new Error("Escrow contract not configured");
  const gameCodeBytes32 = gameCodeToBytes32(gameCode);
  const match = await contract.getMatch(gameCodeBytes32);
  return {
    gameCode: match[0],
    player1: match[1],
    player2: match[2],
    token: match[3],
    wagerAmount: match[4].toString(),
    totalStaked: match[5].toString(),
    createdAt: match[6].toNumber(),
    status: match[7], // 0=PENDING, 1=ACTIVE, 2=RESOLVED, 3=REFUNDED
    winner: match[8],
  };
}

/**
 * Helper: resolve with winner address
 */
async function resolveWithWinner(gameCode, winnerAddress) {
  return resolveMatch(gameCode, winnerAddress);
}

/**
 * Helper: resolve as draw
 */
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
