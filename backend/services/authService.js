const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { Keypair } = require("@stellar/stellar-sdk");

const JWT_SECRET = process.env.JWT_SECRET || "dev-only-insecure-secret-change-me";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";
const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * AuthService — Stellar wallet "sign the nonce" login.
 *
 * Flow:
 *   1. Client calls createChallenge(address) -> gets a one-time message.
 *   2. Client signs that message with their Stellar wallet (Freighter, etc.)
 *      and posts { address, signature } back.
 *   3. verifyLogin() checks the signature against the wallet's public key
 *      and, if valid, issues a JWT the client attaches as a Bearer token on
 *      subsequent requests (see middleware/authMiddleware.js).
 *
 * Challenges are kept in memory (single-process backend, same pattern as
 * timerService's in-memory timer map) and expire after CHALLENGE_TTL_MS.
 */
class AuthService {
	constructor() {
		this.challenges = new Map(); // address -> { nonce, expiresAt }
	}

	createChallenge(address) {
		if (!address || typeof address !== "string") {
			throw new Error("Wallet address is required");
		}

		const nonce = crypto.randomBytes(16).toString("hex");
		const message = `Chesster login\naddress: ${address}\nnonce: ${nonce}`;
		this.challenges.set(address, { message, expiresAt: Date.now() + CHALLENGE_TTL_MS });
		return message;
	}

	/**
	 * Verify a signed challenge and return a signed JWT for the address.
	 * @param {string} address - Stellar public key (G...)
	 * @param {string} signature - base64-encoded signature over the challenge message
	 */
	verifySignature(address, signature) {
		const entry = this.challenges.get(address);
		if (!entry) throw new Error("No pending login challenge for this address");
		if (Date.now() > entry.expiresAt) {
			this.challenges.delete(address);
			throw new Error("Login challenge expired, request a new one");
		}
		if (!signature) throw new Error("Signature is required");

		let keypair;
		try {
			keypair = Keypair.fromPublicKey(address);
		} catch (err) {
			throw new Error("Invalid Stellar wallet address");
		}

		let valid = false;
		try {
			valid = keypair.verify(
				Buffer.from(entry.message, "utf8"),
				Buffer.from(signature, "base64"),
			);
		} catch (err) {
			valid = false;
		}

		if (!valid) throw new Error("Signature verification failed");

		// Challenge is single-use.
		this.challenges.delete(address);
		return true;
	}

	issueToken(address) {
		return jwt.sign({ sub: address, address }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
	}

	verifyToken(token) {
		return jwt.verify(token, JWT_SECRET);
	}
}

module.exports = new AuthService();
module.exports.JWT_SECRET = JWT_SECRET;
