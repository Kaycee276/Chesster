const Redis = require("ioredis-mock");
const { Keypair } = require("@stellar/stellar-sdk");
const { AuthService } = require("../services/authService");

const origin = "https://chesster.example";
const uri = `${origin}/login`;
const options = { origin, uri };
const sign = (key, challenge, encoding = "hex") => Buffer.from(key.sign(Buffer.from(challenge.message))).toString(encoding);

describe("Stellar sign in security", () => {
	let redis;
	let service;
	let key;
	let now;
	beforeEach(async () => {
		redis = new Redis();
		await redis.flushall();
		now = Date.now();
		service = new AuthService({ getRedis: async () => redis, allowedOrigins: [origin, "https://other.example"], now: () => now });
		key = Keypair.random();
	});
	afterEach(() => redis.disconnect());

	test("issues a random 32 byte nonce with exactly five minutes of Redis TTL", async () => {
		const challenge = await service.generateAuthNonce(key.publicKey(), options);
		expect(challenge.nonce).toMatch(/^[a-f0-9]{64}$/);
		expect(await redis.ttl(`auth:nonce:${key.publicKey()}`)).toBe(300);
		expect(challenge).toMatchObject({ address: key.publicKey(), domain: "chesster.example", uri });
		expect(Date.parse(challenge.expirationTime) - Date.parse(challenge.issuedAt)).toBe(300000);
		expect(challenge.message).toContain(`chesster.example wants you to sign in with your Stellar account:\n${key.publicKey()}`);
		for (const text of [`URI: ${uri}`, `Nonce: ${challenge.nonce}`, `Issued At: ${challenge.issuedAt}`, `Expiration Time: ${challenge.expirationTime}`]) {
			expect(challenge.message).toContain(text);
		}
		const another = await service.generateAuthNonce(Keypair.random().publicKey(), options);
		expect(another.nonce).not.toBe(challenge.nonce);
	});

	test("verifies a real Ed25519 signature and issues a wallet bound JWT", async () => {
		const challenge = await service.generateAuthNonce(key.publicKey(), options);
		await expect(service.verifySIWSSignature(key.publicKey(), challenge.message, sign(key, challenge), options)).resolves.toBe(true);
		const token = service.issueToken(key.publicKey());
		expect(service.verifyToken(token)).toMatchObject({ sub: key.publicKey(), address: key.publicKey(), jti: expect.any(String) });
		expect(await redis.get(`auth:nonce:${key.publicKey()}`)).toBeNull();
	});

	test("atomically prevents replay across service instances and concurrent requests", async () => {
		const challenge = await service.generateAuthNonce(key.publicKey(), options);
		const other = new AuthService({ getRedis: async () => redis, allowedOrigins: [origin] });
		const results = await Promise.allSettled([service, other].map((instance) => instance.verifySIWSSignature(key.publicKey(), challenge.message, sign(key, challenge), options)));
		expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
		expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
		await expect(service.verifySIWSSignature(key.publicKey(), challenge.message, sign(key, challenge), options)).rejects.toThrow("nonce");
	});

	test.each(["Nonce:", "URI:", "Issued At:", "Expiration Time:", "Sign in to Chesster."])("rejects alterations to %s even with a valid signature over the altered message", async (field) => {
		const challenge = await service.generateAuthNonce(key.publicKey(), options);
		const altered = { ...challenge, message: challenge.message.replace(field, `${field}altered`) };
		await expect(service.verifySIWSSignature(key.publicKey(), altered.message, sign(key, altered), options)).rejects.toThrow("message mismatch");
		expect(await redis.get(`auth:nonce:${key.publicKey()}`)).toBeNull();
	});

	test("rejects signatures from another wallet and consumes the challenge", async () => {
		const challenge = await service.generateAuthNonce(key.publicKey(), options);
		await expect(service.verifySIWSSignature(key.publicKey(), challenge.message, sign(Keypair.random(), challenge), options)).rejects.toThrow("signature verification failed");
		await expect(service.verifySIWSSignature(key.publicKey(), challenge.message, sign(key, challenge), options)).rejects.toThrow("nonce");
	});

	test.each([undefined, "", "00", "g".repeat(128)])("consumes malformed signature attempts (%s)", async (signature) => {
		const challenge = await service.generateAuthNonce(key.publicKey(), options);
		await expect(service.verifySIWSSignature(key.publicKey(), challenge.message, signature, options)).rejects.toThrow("signature encoding");
		expect(await redis.get(`auth:nonce:${key.publicKey()}`)).toBeNull();
	});

	test.each(["https://evil.example", "https://chesster.example.evil.example", "null", "https://chesster.example/path"])("rejects unapproved origins (%s)", async (untrusted) => {
		await expect(service.generateAuthNonce(key.publicKey(), { origin: untrusted })).rejects.toThrow(/origin/);
	});

	test("rejects cross origin URIs and credentialed URLs", async () => {
		for (const invalidUri of ["https://evil.example/login", "https://user:password@chesster.example/login", "javascript:alert(1)"]) {
			await expect(service.generateAuthNonce(key.publicKey(), { origin, uri: invalidUri })).rejects.toThrow(/origin/);
		}
	});

	test("binds verification to the original domain even when both are allowed", async () => {
		const challenge = await service.generateAuthNonce(key.publicKey(), options);
		await expect(service.verifySIWSSignature(key.publicKey(), challenge.message, sign(key, challenge), { origin: "https://other.example", uri: "https://other.example" })).rejects.toThrow("domain or URI mismatch");
		expect(await redis.get(`auth:nonce:${key.publicKey()}`)).toBeNull();
	});

	test("rejects a different URI on the same origin", async () => {
		const challenge = await service.generateAuthNonce(key.publicKey(), options);
		await expect(service.verifySIWSSignature(key.publicKey(), challenge.message, sign(key, challenge), { origin, uri: `${origin}/other` })).rejects.toThrow("URI mismatch");
	});

	test("rejects exactly at expiry even if Redis has not removed the entry yet", async () => {
		const challenge = await service.generateAuthNonce(key.publicKey(), options);
		now += 300000;
		await expect(service.verifySIWSSignature(key.publicKey(), challenge.message, sign(key, challenge), options)).rejects.toThrow("expired");
	});

	test("rejects future issued challenges if the clock moves backwards", async () => {
		const challenge = await service.generateAuthNonce(key.publicKey(), options);
		now -= 1;
		await expect(service.verifySIWSSignature(key.publicKey(), challenge.message, sign(key, challenge), options)).rejects.toThrow("expired or invalid");
	});

	test("rejects unknown or Redis expired nonces", async () => {
		await expect(service.verifySIWSSignature(key.publicKey(), "message", "00".repeat(64), options)).rejects.toThrow("nonce");
	});

	test("does not allow deletion challenges to authenticate a login", async () => {
		const challenge = await service.generateAuthNonce(key.publicKey(), { ...options, purpose: "delete-account" });
		await expect(service.verifySIWSSignature(key.publicKey(), challenge.message, sign(key, challenge), options)).rejects.toThrow("purpose");
	});

	test("retains base64 signatures and purpose verification for legacy routes", async () => {
		const message = await service.createChallenge(key.publicKey(), "delete-account", options);
		await expect(service.verifySignature(key.publicKey(), sign(key, { message }, "base64"), "delete-account", options)).resolves.toBe(true);
	});

	test("rejects invalid wallets and unsupported purposes", async () => {
		await expect(service.generateAuthNonce("not a Stellar key", options)).rejects.toThrow("wallet address");
		await expect(service.generateAuthNonce(key.publicKey(), { ...options, purpose: "transfer" })).rejects.toThrow("purpose");
	});

	test("fails closed when Redis is unavailable or commands fail", async () => {
		const unavailable = new AuthService({ getRedis: async () => null, allowedOrigins: [origin] });
		await expect(unavailable.generateAuthNonce(key.publicKey(), options)).rejects.toMatchObject({ status: 503 });
		await expect(unavailable.verifySIWSSignature(key.publicKey(), "message", "signature", options)).rejects.toMatchObject({ status: 503 });
		jest.spyOn(redis, "set").mockRejectedValueOnce(new Error("Redis unavailable"));
		await expect(service.generateAuthNonce(key.publicKey(), options)).rejects.toThrow("Redis unavailable");
	});
});
