const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");

jest.mock("../config/supabase", () => require("./helpers/fakeSupabase")());
jest.mock("../models/gameModel", () => ({}));
jest.mock("../services/timerService", () => ({}));

const supabase = require("../config/supabase");
const auditService = require("../services/auditService");
const gameRoutes = require("../routes/gameRoutes");
const { JWT_SECRET } = require("../middleware/authMiddleware");
const { auditFixture, GAME_ID } = require("./helpers/auditFixtures");

function tokenFor(address, extra = {}) {
	return `Bearer ${jwt.sign({ sub: address, address, ...extra }, JWT_SECRET, { expiresIn: "5m" })}`;
}

function buildApp() {
	const app = express();
	app.use(express.json());
	app.use("/api", gameRoutes);
	return app;
}

describe("GET /api/games/:id/audit-export", () => {
	let app;
	let fixture;

	beforeEach(() => {
		supabase.__reset();
		fixture = auditFixture();
		supabase.__setTable("games", [fixture.game]);
		supabase.__setTable("moves", fixture.moves);
		supabase.__setTable("match_audit_logs", fixture.auditLogs);
		delete process.env.ADMIN_ADDRESSES;
		app = buildApp();
	});

	it("rejects unauthenticated requests", async () => {
		const res = await request(app).get("/api/games/AUD123/audit-export");
		expect(res.status).toBe(401);
	});

	it("forbids users who did not play the match", async () => {
		const res = await request(app).get("/api/games/AUD123/audit-export").set("Authorization", tokenFor("GSTRANGER"));

		expect(res.status).toBe(403);
		expect(res.body.data).toBeUndefined();
	});

	it("returns 404 for unknown games", async () => {
		const res = await request(app).get("/api/games/NOPE00/audit-export").set("Authorization", tokenFor("GWHITE"));
		expect(res.status).toBe(404);
	});

	it("rejects unsupported formats", async () => {
		const res = await request(app).get("/api/games/AUD123/audit-export?format=xml").set("Authorization", tokenFor("GWHITE"));
		expect(res.status).toBe(400);
	});

	it("returns the signed audit package to a match player", async () => {
		const res = await request(app).get(`/api/games/${GAME_ID}/audit-export`).set("Authorization", tokenFor("GBLACK"));

		expect(res.status).toBe(200);
		expect(res.headers["cache-control"]).toBe("no-store");
		expect(res.headers["content-disposition"]).toBeUndefined();

		const audit = res.body.data;
		expect(audit.match.gameCode).toBe("AUD123");
		expect(audit.moves.map((m) => m.moveNumber)).toEqual([1, 2, 3]);
		expect(audit.events).toHaveLength(4);
		expect(res.headers["x-audit-signature"]).toBe(audit.integrity.signature);
		expect(res.headers["x-audit-outcome-hash"]).toBe(audit.integrity.outcomeHash);
		expect(auditService.verifyAuditPackage(audit)).toBe(true);
	});

	it("lets admins export any match", async () => {
		process.env.ADMIN_ADDRESSES = "GADMIN";
		const res = await request(app).get("/api/games/AUD123/audit-export").set("Authorization", tokenFor("GADMIN"));
		expect(res.status).toBe(200);
	});

	it("serves the JSON package as a download when requested", async () => {
		const res = await request(app)
			.get("/api/games/AUD123/audit-export?download=true")
			.set("Authorization", tokenFor("GWHITE"));

		expect(res.status).toBe(200);
		expect(res.headers["content-disposition"]).toBe('attachment; filename="chesster-audit-AUD123.json"');
	});

	it("exports a downloadable CSV timeline", async () => {
		const res = await request(app)
			.get("/api/games/AUD123/audit-export?format=csv")
			.set("Authorization", tokenFor("GWHITE"));

		expect(res.status).toBe(200);
		expect(res.headers["content-type"]).toMatch(/^text\/csv/);
		expect(res.headers["content-disposition"]).toBe('attachment; filename="chesster-audit-AUD123.csv"');
		expect(res.headers["x-audit-signature"]).toMatch(/^[0-9a-f]{64}$/);

		const lines = res.text.trim().split("\r\n");
		expect(lines[0].startsWith("sequence,kind,timestamp")).toBe(true);
		expect(lines).toHaveLength(1 + 3 + 4);
	});
});
