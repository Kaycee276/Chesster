const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { Keypair } = require("@stellar/stellar-sdk");

const JWT_SECRET = process.env.JWT_SECRET || "dev-only-insecure-secret-change-me";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";
const CHALLENGE_TTL_MS = Number(process.env.AUTH_CHALLENGE_TTL_MS) || 5 * 60 * 1000; // 5 minutes
const DEFAULT_MAX_CHALLENGES = Number(process.env.AUTH_CHALLENGE_MAX) || 5000;
const DEFAULT_SWEEP_INTERVAL_MS = Number(process.env.AUTH_CHALLENGE_SWEEP_MS) || 60 * 1000;

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
 * Capacity policy (documented):
 *   - Challenges are kept in memory (single-process backend, same pattern as
 *     timerService's in-memory timer map) and expire after `ttlMs`.
 *   - One active challenge per address: creating a challenge for an address
 *     that already has one replaces it (the previous nonce is invalidated).
 *   - The store holds at most `maxEntries` addresses. When full, creation
 *     evicts the oldest-inserted entry (Map insertion order) to make room.
 *     Expired entries are preferred for eviction first via pruneExpired().
 *   - Expired entries are pruned on a predictable schedule (interval sweep,
 *     default 60s) and opportunistically on createChallenge/verifySignature
 *     and via the public pruneExpired() method. Node runs JS on a single
 *     thread so individual Map get/set/delete operations are atomic — no lock
 *     is needed; concurrent requests are serialized by the event loop.
 *   - Call stop() (or shutdown()) on process shutdown to clear the sweep
 *     timer so the event loop can exit cleanly.
 */
class AuthService {
	constructor(options = {}) {
		this.challenges = new Map(); // address -> { message, purpose, expiresAt, createdAt }
		this.ttlMs = options.ttlMs ?? CHALLENGE_TTL_MS;
		this.maxEntries = options.maxEntries ?? DEFAULT_MAX_CHALLENGES;
		this.sweepIntervalMs = options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
		this._now = options.now ?? (() => Date.now());
		this._timer = null;
		if (options.autoSweep ?? true) this.startSweep();
	}

	_nowMs() {
		return this._now();
	}

	startSweep() {
		if (this._timer || !this.sweepIntervalMs || this.sweepIntervalMs <= 0) return;
		this._timer = setInterval(() => {
			try {
				this.pruneExpired();
			} catch {
				// Never let the background sweep crash the process.
			}
		}, this.sweepIntervalMs);
		if (typeof this._timer.unref === "function") this._timer.unref();
	}

	stop() {
		if (this._timer) {
			clearInterval(this._timer);
			this._timer = null;
		}
	}

	shutdown() {
		this.stop();
	}

	get size() {
		return this.challenges.size;
	}

	/** Remove all entries whose expiry has passed. Returns number removed. */
	pruneExpired(now = this._nowMs()) {
		let removed = 0;
		for (const [address, entry] of this.challenges) {
			if (now > entry.expiresAt) {
				this.challenges.delete(address);
				removed += 1;
			}
		}
		return removed;
	}

	_evictOldest() {
		const oldest = this.challenges.keys().next();
		if (!oldest.done) this.challenges.delete(oldest.value);
	}

	createChallenge(address, purpose = "login") {
		if (!address || typeof address !== "string") {
			throw new Error("Wallet address is required");
		}
		if (!["login", "delete-account"].includes(purpose)) {
			throw new Error("Unsupported authentication challenge purpose");
		}

		const now = this._nowMs();

		// Refreshing the same address replaces its challenge (one active each),
		// so delete first to renew insertion order for capacity eviction.
		this.challenges.delete(address);

		// Opportunistic bound: drop expired entries before enforcing capacity.
		if (this.challenges.size >= this.maxEntries) this.pruneExpired(now);
		while (this.challenges.size >= this.maxEntries) this._evictOldest();

		const nonce = crypto.randomBytes(16).toString("hex");
		const action = purpose === "delete-account" ? "account deletion" : "login";
		const message = `Chesster ${action}\naddress: ${address}\nnonce: ${nonce}`;
		this.challenges.set(address, {
			message,
			purpose,
			expiresAt: now + this.ttlMs,
			createdAt: now,
		});
		return message;
	}

	/**
	 * Verify a signed challenge and return a signed JWT for the address.
	 * @param {string} address - Stellar public key (G...)
	 * @param {string} signature - base64-encoded signature over the challenge message
	 */
	verifySignature(address, signature, expectedPurpose = "login") {
		const entry = this.challenges.get(address);
		if (!entry) throw new Error("No pending login challenge for this address");
		if (entry.purpose !== expectedPurpose) {
			throw new Error("Authentication challenge purpose mismatch");
		}
		if (this._nowMs() > entry.expiresAt) {
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
		return jwt.sign({ sub: address, address }, JWT_SECRET, {
			expiresIn: JWT_EXPIRES_IN,
			jwtid: crypto.randomUUID(),
		});
	}

	verifyToken(token) {
		return jwt.verify(token, JWT_SECRET);
	}

	/** Test/support hook: reconfigure bounds and clock. */
	_configure(options = {}) {
		if (options.ttlMs !== undefined) this.ttlMs = options.ttlMs;
		if (options.maxEntries !== undefined) this.maxEntries = options.maxEntries;
		if (options.sweepIntervalMs !== undefined) {
			this.stop();
			this.sweepIntervalMs = options.sweepIntervalMs;
			if (options.autoSweep ?? true) this.startSweep();
		}
		if (options.now !== undefined) this._now = options.now;
		return this;
	}

	/** Test/support hook: clear all challenges. */
	_reset() {
		this.challenges.clear();
		return this;
	}
}

const singleton = new AuthService();
singleton.AuthService = AuthService;
singleton.CHALLENGE_TTL_MS = CHALLENGE_TTL_MS;
singleton.DEFAULT_MAX_CHALLENGES = DEFAULT_MAX_CHALLENGES;
singleton.DEFAULT_SWEEP_INTERVAL_MS = DEFAULT_SWEEP_INTERVAL_MS;

module.exports = singleton;
module.exports.JWT_SECRET = JWT_SECRET;
