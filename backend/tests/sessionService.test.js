const { SessionService } = require("../services/sessionService");

describe("SessionService", () => {
	const originalRedisUrl = process.env.REDIS_URL;

	beforeEach(() => {
		delete process.env.REDIS_URL;
	});

	afterAll(() => {
		if (originalRedisUrl === undefined) delete process.env.REDIS_URL;
		else process.env.REDIS_URL = originalRedisUrl;
	});

	test("invalidates tokens issued before account deletion", async () => {
		const service = new SessionService();
		const issuedAt = Math.floor(Date.now() / 1000) - 1;

		expect(await service.isTokenRevoked("GPLAYER", issuedAt)).toBe(false);
		await service.revokeAll("GPLAYER");
		expect(await service.isTokenRevoked("GPLAYER", issuedAt)).toBe(true);
	});

	test("fails closed for tokens without an issued-at timestamp", async () => {
		const service = new SessionService();
		expect(await service.isTokenRevoked("GPLAYER", undefined)).toBe(true);
	});
});
