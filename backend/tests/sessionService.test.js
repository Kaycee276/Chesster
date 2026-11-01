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

	describe("Session Token Rotation and JTI Blacklisting", () => {
		let service;

		beforeEach(() => {
			service = new SessionService();
			service.resetLocalState();
		});

		test("rotates session and blacklists old JTI on new login", async () => {
			const address = "GWALLETADDRESS123";
			const oldJti = "old-jti-1";
			const newJti = "new-jti-2";
			const ipSubnet = "192.168.1";
			const ttl = 604800; // 7 days in seconds

			// Simulate existing active JTI
			service.activeJti.set(address, oldJti);

			// Rotate session
			await service.rotateSession(address, newJti, ipSubnet, ttl);

			// Old JTI should be blacklisted
			expect(await service.isJtiBlacklisted(oldJti)).toBe(true);

			// New JTI should NOT be blacklisted
			expect(await service.isJtiBlacklisted(newJti)).toBe(false);

			// New JTI should be stored as active
			expect(service.activeJti.get(address)).toBe(newJti);
		});

		test("prevents token hijacking by blacklisting old JTI after wallet reconnect", async () => {
			const address = "GPLAYER1";
			const jti1 = "first-login-jti";
			const jti2 = "second-login-jti";
			const ipSubnet = "10.0.0";
			const ttl = 604800;

			// First login
			await service.rotateSession(address, jti1, ipSubnet, ttl);
			expect(await service.isJtiBlacklisted(jti1)).toBe(false);

			// Wallet reconnect - second login
			await service.rotateSession(address, jti2, ipSubnet, ttl);

			// Old JTI should be blacklisted now
			expect(await service.isJtiBlacklisted(jti1)).toBe(true);
			expect(await service.isJtiBlacklisted(jti2)).toBe(false);
		});

		test("stores and retrieves IP binding for JTI", async () => {
			const address = "GUSER456";
			const jti = "session-jti-123";
			const ipSubnet = "172.16.0";
			const ttl = 604800;

			await service.rotateSession(address, jti, ipSubnet, ttl);

			const retrievedIp = await service.getIpBinding(jti);
			expect(retrievedIp).toBe(ipSubnet);
		});

		test("returns null for IP binding of non-existent JTI", async () => {
			const binding = await service.getIpBinding("non-existent-jti");
			expect(binding).toBeNull();
		});

		test("validates IP subnet matching with exact match", () => {
			expect(service.isIpSubnetMatch("192.168.1", "192.168.1")).toBe(true);
			expect(service.isIpSubnetMatch("10.0.0", "10.0.0")).toBe(true);
		});

		test("allows localhost bypass for testing", () => {
			expect(service.isIpSubnetMatch("127.0.0.1", "127.0.0.1")).toBe(true);
			expect(service.isIpSubnetMatch("192.168.1", "127.0.0.1")).toBe(true);
			expect(service.isIpSubnetMatch("127.0.0.1", "192.168.1")).toBe(true);
		});

		test("rejects IP subnet mismatch", () => {
			expect(service.isIpSubnetMatch("192.168.1", "192.168.2")).toBe(false);
			expect(service.isIpSubnetMatch("10.0.0", "10.0.1")).toBe(false);
			expect(service.isIpSubnetMatch("172.16.0", "172.17.0")).toBe(false);
		});

		test("allows null/missing IP bindings", () => {
			expect(service.isIpSubnetMatch(null, "192.168.1")).toBe(true);
			expect(service.isIpSubnetMatch("192.168.1", null)).toBe(true);
			expect(service.isIpSubnetMatch(null, null)).toBe(true);
		});

		test("handles multiple concurrent wallet sessions independently", async () => {
			const wallet1 = "GWALLET1";
			const wallet2 = "GWALLET2";
			const jti1 = "wallet1-jti";
			const jti2 = "wallet2-jti";
			const ipSubnet1 = "192.168.1";
			const ipSubnet2 = "192.168.2";
			const ttl = 604800;

			// Both wallets login with different IPs
			await service.rotateSession(wallet1, jti1, ipSubnet1, ttl);
			await service.rotateSession(wallet2, jti2, ipSubnet2, ttl);

			// Each JTI has correct binding
			expect(await service.getIpBinding(jti1)).toBe(ipSubnet1);
			expect(await service.getIpBinding(jti2)).toBe(ipSubnet2);

			// Neither is blacklisted
			expect(await service.isJtiBlacklisted(jti1)).toBe(false);
			expect(await service.isJtiBlacklisted(jti2)).toBe(false);

			// Wallet1 rotates (reconnects)
			const newJti1 = "wallet1-new-jti";
			await service.rotateSession(wallet1, newJti1, ipSubnet1, ttl);

			// Old JTI1 blacklisted, but JTI2 still valid
			expect(await service.isJtiBlacklisted(jti1)).toBe(true);
			expect(await service.isJtiBlacklisted(jti2)).toBe(false);
			expect(await service.isJtiBlacklisted(newJti1)).toBe(false);
		});

		test("rejects rotation with missing required parameters", async () => {
			const address = "GPLAYER";
			const jti = "some-jti";
			const ipSubnet = "192.168.1";
			const ttl = 604800;

			// Missing address
			await expect(service.rotateSession(null, jti, ipSubnet, ttl)).rejects.toThrow(
				"address, newJti, and ttlSeconds are required",
			);

			// Missing JTI
			await expect(service.rotateSession(address, null, ipSubnet, ttl)).rejects.toThrow(
				"address, newJti, and ttlSeconds are required",
			);

			// Missing TTL
			await expect(service.rotateSession(address, jti, ipSubnet, null)).rejects.toThrow(
				"address, newJti, and ttlSeconds are required",
			);
		});

		test("clears active JTI and IP bindings on account deletion", async () => {
			const address = "GDELETE_ME";
			const jti = "delete-me-jti";
			const ipSubnet = "192.168.1";
			const ttl = 604800;

			// Setup session
			await service.rotateSession(address, jti, ipSubnet, ttl);
			expect(service.activeJti.get(address)).toBe(jti);

			// Revoke all (simulate account deletion)
			await service.revokeAll(address);

			// Active JTI should be cleared
			expect(service.activeJti.get(address)).toBeUndefined();
		});

		test("maintains session isolation: rotating wallet A does not affect wallet B", async () => {
			const walletA = "GWALLETA";
			const walletB = "GWALLETB";
			const jtiA1 = "a-jti-1";
			const jtiA2 = "a-jti-2";
			const jtiB = "b-jti-1";
			const ttl = 604800;

			// Both wallets have sessions
			await service.rotateSession(walletA, jtiA1, "192.168.1", ttl);
			await service.rotateSession(walletB, jtiB, "10.0.0", ttl);

			// Wallet A rotates
			await service.rotateSession(walletA, jtiA2, "192.168.1", ttl);

			// Only wallet A's old JTI is blacklisted
			expect(await service.isJtiBlacklisted(jtiA1)).toBe(true);
			expect(await service.isJtiBlacklisted(jtiB)).toBe(false);
			expect(await service.isJtiBlacklisted(jtiA2)).toBe(false);
		});
	});
});
