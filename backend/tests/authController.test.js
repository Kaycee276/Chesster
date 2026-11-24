const express = require("express");
const request = require("supertest");
const Redis = require("ioredis-mock");
const { Keypair } = require("@stellar/stellar-sdk");
jest.mock("../config/redis", () => ({ getRedisConnection: jest.fn() }));
jest.mock("../models/userModel", () => ({ findOrCreateByAddress: jest.fn() }));
jest.mock("../services/sessionService", () => ({ rotateSession: jest.fn() }));
const { getRedisConnection } = require("../config/redis");
const authService = require("../services/authService");
const userModel = require("../models/userModel");
const sessionService = require("../services/sessionService");
const routes = require("../routes/authRoutes");
const origin = "https://chesster.example";

describe("wallet authentication endpoints", () => {
	let redis;
	let app;
	let key;
	beforeEach(async () => {
		jest.clearAllMocks();
		redis = new Redis();
		await redis.flushall();
		getRedisConnection.mockResolvedValue(redis);
		authService.allowedOrigins = [origin];
		app = express();
		app.use(express.json());
		app.use("/api", routes);
		key = Keypair.random();
		userModel.findOrCreateByAddress.mockResolvedValue({ wallet_address: key.publicKey() });
	});
	afterEach(() => redis.disconnect());

	test("issues an uncacheable nonce and verifies it into a rotated JWT session", async () => {
		const challenge = await request(app).get("/api/auth/nonce").query({ address: key.publicKey(), uri: `${origin}/login` }).set("Origin", origin);
		expect(challenge.status).toBe(200);
		expect(challenge.headers["cache-control"]).toBe("no-store");
		const { message, uri } = challenge.body.data;
		const signature = Buffer.from(key.sign(Buffer.from(message))).toString("hex");
		const response = await request(app).post("/api/auth/verify").set("Origin", origin).send({ address: key.publicKey(), message, signature, uri });
		expect(response.status).toBe(200);
		expect(authService.verifyToken(response.body.data.token).address).toBe(key.publicKey());
		expect(sessionService.rotateSession).toHaveBeenCalledWith(key.publicKey(), expect.any(String), expect.any(String), expect.any(Number));
		const replay = await request(app).post("/api/auth/verify").set("Origin", origin).send({ address: key.publicKey(), message, signature, uri });
		expect(replay.status).toBe(401);
	});

	test("rejects forged signatures before user lookup or token issuance", async () => {
		const challenge = await authService.generateAuthNonce(key.publicKey(), { origin });
		const response = await request(app).post("/api/auth/verify").set("Origin", origin).send({ address: key.publicKey(), message: challenge.message, signature: "00".repeat(64) });
		expect(response.status).toBe(401);
		expect(userModel.findOrCreateByAddress).not.toHaveBeenCalled();
		expect(sessionService.rotateSession).not.toHaveBeenCalled();
	});

	test("requires an Origin header and rejects unapproved origins", async () => {
		for (const headers of [{}, { Origin: "https://evil.example" }]) {
			const response = await request(app).get("/api/auth/nonce").query({ address: key.publicKey() }).set(headers);
			expect(response.status).toBe(400);
		}
	});

	test("consumes a verification with a missing message", async () => {
		await authService.generateAuthNonce(key.publicKey(), { origin });
		const response = await request(app).post("/api/auth/verify").set("Origin", origin).send({ address: key.publicKey(), signature: "00".repeat(64) });
		expect(response.status).toBe(401);
		expect(await redis.get(`auth:nonce:${key.publicKey()}`)).toBeNull();
	});

	test("consumes verification attempts with a missing or unapproved origin", async () => {
		for (const headers of [{}, { Origin: "https://evil.example" }]) {
			const challenge = await authService.generateAuthNonce(key.publicKey(), { origin });
			const signature = Buffer.from(key.sign(Buffer.from(challenge.message))).toString("hex");
			const response = await request(app).post("/api/auth/verify").set(headers).send({ address: key.publicKey(), message: challenge.message, signature });
			expect(response.status).toBe(401);
			expect(await redis.get(`auth:nonce:${key.publicKey()}`)).toBeNull();
		}
		expect(userModel.findOrCreateByAddress).not.toHaveBeenCalled();
	});

	test("preserves the legacy challenge and base64 login flow", async () => {
		const challenge = await request(app).post("/api/auth/challenge").set("Origin", origin).send({ address: key.publicKey() });
		expect(challenge.status).toBe(200);
		const signature = Buffer.from(key.sign(Buffer.from(challenge.body.data.message))).toString("base64");
		const response = await request(app).post("/api/auth/login").set("Origin", origin).send({ address: key.publicKey(), signature });
		expect(response.status).toBe(200);
	});

	test("reports unavailable Redis and never issues a token", async () => {
		getRedisConnection.mockResolvedValue(null);
		const response = await request(app).get("/api/auth/nonce").set("Origin", origin).query({ address: key.publicKey() });
		expect(response.status).toBe(503);
		expect(sessionService.rotateSession).not.toHaveBeenCalled();
	});
});
