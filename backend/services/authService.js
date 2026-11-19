const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { Keypair } = require("@stellar/stellar-sdk");
const { getRedisConnection } = require("../config/redis");

const JWT_SECRET = process.env.JWT_SECRET || "dev-only-insecure-secret-change-me";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";
const CHALLENGE_TTL_SECONDS = 300;

// Consume before validating anything else. One Redis operation ensures that
// simultaneous verification requests on different servers cannot reuse it.
const CONSUME_CHALLENGE = `
local challenge = redis.call('GET', KEYS[1])
if challenge then redis.call('DEL', KEYS[1]) end
return challenge
`;

/** Stellar wallet sign in with shared, single-use, origin-bound challenges. */
class AuthService {
	constructor(options = {}) {
		this.getRedis = options.getRedis ?? getRedisConnection;
		this._now = options.now ?? Date.now;
		this.allowedOrigins = options.allowedOrigins ?? (
			process.env.AUTH_ALLOWED_ORIGINS || process.env.CORS_ORIGIN ||
			(process.env.NODE_ENV === "production" ? "" : "http://localhost:3090")
		).split(",").map((origin) => origin.trim()).filter((origin) => origin && origin !== "*");
	}

	async _redis() {
		const redis = await this.getRedis();
		if (!redis) {
			const error = new Error("Authentication store unavailable, please try again later");
			error.status = 503;
			throw error;
		}
		return redis;
	}

	_binding(origin, uri = origin) {
		let originUrl;
		let clientUrl;
		try {
			originUrl = new URL(origin);
			clientUrl = new URL(uri);
		} catch {
			throw new Error("Invalid authentication origin or URI");
		}
		if (
			!["http:", "https:"].includes(originUrl.protocol) ||
			origin !== originUrl.origin ||
			!this.allowedOrigins.includes(origin) ||
			clientUrl.origin !== origin || clientUrl.username || clientUrl.password
		) {
			throw new Error("Authentication origin is not allowed");
		}
		return { origin, domain: originUrl.host, uri: clientUrl.href };
	}

	_message(challenge) {
		const statement = challenge.purpose === "delete-account"
			? "Authorize account deletion on Chesster."
			: "Sign in to Chesster.";
		return `${challenge.domain} wants you to sign in with your Stellar account:\n${challenge.address}\n\n${statement}\n\nURI: ${challenge.uri}\nVersion: 1\nNonce: ${challenge.nonce}\nIssued At: ${challenge.issuedAt}\nExpiration Time: ${challenge.expirationTime}`;
	}

	async generateAuthNonce(address, options = {}) {
		try {
			Keypair.fromPublicKey(address);
		} catch {
			throw new Error("Invalid Stellar wallet address");
		}
		const purpose = options.purpose ?? "login";
		if (!["login", "delete-account"].includes(purpose)) {
			throw new Error("Unsupported authentication challenge purpose");
		}
		const binding = this._binding(options.origin ?? this.allowedOrigins[0], options.uri);
		const now = this._now();
		const challenge = {
			address,
			...binding,
			purpose,
			nonce: crypto.randomBytes(32).toString("hex"),
			issuedAt: new Date(now).toISOString(),
			expirationTime: new Date(now + CHALLENGE_TTL_SECONDS * 1000).toISOString(),
		};
		const redis = await this._redis();
		await redis.set(`auth:nonce:${address}`, JSON.stringify(challenge), "EX", CHALLENGE_TTL_SECONDS);
		return { ...challenge, message: this._message(challenge) };
	}

	/** Legacy challenge route retains its message response and deletion purpose. */
	async createChallenge(address, purpose = "login", options = {}) {
		return (await this.generateAuthNonce(address, { ...options, purpose })).message;
	}

	async verifySIWSSignature(address, message, signature, options = {}) {
		const redis = await this._redis();
		const raw = await redis.eval(CONSUME_CHALLENGE, 1, `auth:nonce:${address}`);
		if (!raw) throw new Error("Invalid or expired authentication nonce");
		const challenge = JSON.parse(raw);
		const binding = this._binding(options.origin ?? this.allowedOrigins[0], options.uri ?? challenge.uri);
		if (binding.origin !== challenge.origin || binding.domain !== challenge.domain || binding.uri !== challenge.uri) {
			throw new Error("Authentication domain or URI mismatch");
		}
		if (challenge.address !== address || challenge.purpose !== (options.purpose ?? "login")) {
			throw new Error("Authentication challenge purpose or address mismatch");
		}
		const issuedAt = Date.parse(challenge.issuedAt);
		const expiration = Date.parse(challenge.expirationTime);
		const now = this._now();
		if (!Number.isFinite(issuedAt) || !Number.isFinite(expiration) || issuedAt > now ||
			expiration - issuedAt !== CHALLENGE_TTL_SECONDS * 1000 || now >= expiration) {
			throw new Error("Authentication challenge expired or invalid");
		}
		const expected = this._message(challenge);
		if ((options.requireMessage && typeof message !== "string") || (message !== undefined && message !== expected)) {
			throw new Error("Authentication challenge message mismatch");
		}
		const encoding = options.signatureEncoding ?? "hex";
		if (typeof signature !== "string" ||
			(encoding === "hex" ? !/^[0-9a-f]{128}$/i.test(signature) :
				encoding !== "base64" || !/^[A-Za-z0-9+/]{86}==$/.test(signature))) {
			throw new Error("Invalid signature encoding");
		}
		let valid = false;
		try {
			valid = Keypair.fromPublicKey(address).verify(Buffer.from(expected, "utf8"), Buffer.from(signature, encoding));
		} catch {
			valid = false;
		}
		if (!valid) throw new Error("Cryptographic signature verification failed");
		return true;
	}

	async verifySignature(address, signature, expectedPurpose = "login", options = {}) {
		return this.verifySIWSSignature(address, undefined, signature, {
			...options, purpose: expectedPurpose, signatureEncoding: "base64",
		});
	}

	issueToken(address, ipSubnet = null) {
		if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
			throw new Error("JWT_SECRET must be configured for authentication");
		}
		return jwt.sign({ sub: address, address, ...(ipSubnet && { ipSubnet }) }, JWT_SECRET, {
			expiresIn: JWT_EXPIRES_IN,
			jwtid: crypto.randomUUID(),
		});
	}

	verifyToken(token) {
		return jwt.verify(token, JWT_SECRET);
	}
}

module.exports = new AuthService();
module.exports.AuthService = AuthService;
module.exports.JWT_SECRET = JWT_SECRET;
module.exports.CHALLENGE_TTL_SECONDS = CHALLENGE_TTL_SECONDS;
