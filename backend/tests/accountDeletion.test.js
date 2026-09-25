process.env.JWT_SECRET = "test-secret";

const fs = require("fs");
const path = require("path");
const express = require("express");
const jwt = require("jsonwebtoken");
const request = require("supertest");

jest.mock("../services/authService", () => ({
	createChallenge: jest.fn(),
	verifySignature: jest.fn(),
	issueToken: jest.fn(),
}));
jest.mock("../models/userModel", () => ({
	anonymizeUser: jest.fn(),
	findOrCreateByAddress: jest.fn(),
}));
jest.mock("../services/sessionService", () => ({
	isTokenRevoked: jest.fn().mockResolvedValue(false),
	revokeAll: jest.fn(),
}));

const authService = require("../services/authService");
const sessionService = require("../services/sessionService");
const userModel = require("../models/userModel");
const authRoutes = require("../routes/authRoutes");

function buildApp() {
	const app = express();
	app.use(express.json());
	app.use("/api", authRoutes);
	return app;
}

describe("account deletion", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		sessionService.isTokenRevoked.mockResolvedValue(false);
	});

	test("requires JWT authentication", async () => {
		const response = await request(buildApp())
			.post("/api/users/delete-account")
			.send({ signature: "signed" });

		expect(response.status).toBe(401);
		expect(userModel.anonymizeUser).not.toHaveBeenCalled();
	});

	test("does not issue replacement tokens for a deleted profile", async () => {
		userModel.findOrCreateByAddress.mockResolvedValue({
			wallet_address: "GPLAYER",
			is_deleted: true,
		});

		const response = await request(buildApp())
			.post("/api/auth/login")
			.send({ address: "GPLAYER", signature: "signed-login-challenge" });

		expect(response.status).toBe(401);
		expect(response.body.error).toBe("Account has been deleted");
		expect(authService.issueToken).not.toHaveBeenCalled();
	});

	test("requires a deletion-purpose wallet signature and revokes all sessions", async () => {
		const token = jwt.sign({ address: "GPLAYER" }, "test-secret", { expiresIn: "1h" });
		userModel.anonymizeUser.mockResolvedValue({
			deletedChatMessages: 3,
			deletedAuditLogs: 2,
			preservedGames: 7,
		});

		const response = await request(buildApp())
			.post("/api/users/delete-account")
			.set("Authorization", `Bearer ${token}`)
			.send({ signature: "signed-deletion-challenge" });

		expect(response.status).toBe(200);
		expect(authService.verifySignature).toHaveBeenCalledWith(
			"GPLAYER",
			"signed-deletion-challenge",
			"delete-account",
		);
		expect(userModel.anonymizeUser).toHaveBeenCalledWith("GPLAYER");
		expect(sessionService.revokeAll).toHaveBeenCalledWith("GPLAYER");
		expect(response.body.data.preservedGames).toBe(7);
	});

	test("migration redacts PII and never deletes games or moves", () => {
		const migration = fs.readFileSync(
			path.join(__dirname, "../database/migrations/019_add_account_redaction.sql"),
			"utf8",
		);

		expect(migration).toMatch(/email = NULL/);
		expect(migration).toMatch(/avatar_url = NULL/);
		expect(migration).toMatch(/bio = NULL/);
		expect(migration).toMatch(/DELETE FROM chat_messages/);
		expect(migration).toMatch(/DELETE FROM match_audit_logs/);
		expect(migration).not.toMatch(/DELETE FROM (games|moves)/);
	});
});
