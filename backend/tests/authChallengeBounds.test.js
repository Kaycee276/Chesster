const Redis = require("ioredis-mock");
const { Keypair } = require("@stellar/stellar-sdk");
const { AuthService } = require("../services/authService");

// Redis now owns capacity/expiration; retain the single-active-challenge
// regression without relying on a process-local Map or sweep timers.
describe("shared authentication challenge bounds", () => {
	let redis;
	let service;
	beforeEach(async () => {
		redis = new Redis();
		await redis.flushall();
		service = new AuthService({ getRedis: async () => redis, allowedOrigins: ["https://chesster.example"] });
	});
	afterEach(() => redis.disconnect());

	test("reissue replaces the nonce and keeps one expiring entry per wallet", async () => {
		const key = Keypair.random();
		const first = await service.createChallenge(key.publicKey());
		const second = await service.createChallenge(key.publicKey());
		expect(second).not.toBe(first);
		expect(await redis.keys("auth:nonce:*")).toHaveLength(1);
		expect(await redis.ttl(`auth:nonce:${key.publicKey()}`)).toBe(300);
		const staleSignature = Buffer.from(key.sign(Buffer.from(first))).toString("base64");
		await expect(service.verifySignature(key.publicKey(), staleSignature)).rejects.toThrow("signature verification failed");
		// Even failed attempts consume the replacement nonce.
		await expect(service.verifySignature(key.publicKey(), Buffer.from(key.sign(Buffer.from(second))).toString("base64"))).rejects.toThrow("nonce");
		const fresh = await service.createChallenge(key.publicKey());
		await expect(service.verifySignature(key.publicKey(), Buffer.from(key.sign(Buffer.from(fresh))).toString("base64"))).resolves.toBe(true);
	});

	test("keeps challenges for distinct wallets independent", async () => {
		const a = Keypair.random();
		const b = Keypair.random();
		const first = await service.createChallenge(a.publicKey());
		const second = await service.createChallenge(b.publicKey());
		await service.verifySignature(a.publicKey(), Buffer.from(a.sign(Buffer.from(first))).toString("base64"));
		await expect(service.verifySignature(b.publicKey(), Buffer.from(b.sign(Buffer.from(second))).toString("base64"))).resolves.toBe(true);
	});
});
