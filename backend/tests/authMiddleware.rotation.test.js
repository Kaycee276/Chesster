const jwt = require("jsonwebtoken");
const { requireAuth, optionalAuth } = require("../middleware/authMiddleware");
const sessionService = require("../services/sessionService");

const JWT_SECRET = process.env.JWT_SECRET || "dev-only-insecure-secret-change-me";

describe("authMiddleware - Session Token Rotation & IP Binding", () => {
	let mockReq, mockRes, mockNext;

	beforeEach(() => {
		sessionService.resetLocalState();
		mockRes = {
			status: jest.fn().mockReturnThis(),
			json: jest.fn().mockReturnThis(),
		};
		mockNext = jest.fn();
	});

	describe("requireAuth - JTI Blacklist Validation", () => {
		test("rejects blacklisted JTI with 401", async () => {
			const address = "GPLAYER1";
			const jti = "blacklisted-jti";
			const token = jwt.sign(
				{ address, sub: address },
				JWT_SECRET,
				{ jwtid: jti, expiresIn: "7d" },
			);

			// Manually blacklist the JTI
			await sessionService.rotateSession(address, "new-jti", "192.168.1", 604800);
			// Now rotate again to blacklist the new-jti, and set jti as active initially
			sessionService.activeJti.set(address, jti);
			// Then rotate to create a scenario where jti is blacklisted
			await sessionService.rotateSession(address, "another-jti", "192.168.1", 604800);

			mockReq = {
				headers: {
					authorization: `Bearer ${token}`,
				},
				socket: {
					remoteAddress: "192.168.1.100",
				},
			};

			await requireAuth(mockReq, mockRes, mockNext);

			expect(mockRes.status).toHaveBeenCalledWith(401);
			expect(mockNext).not.toHaveBeenCalled();
		});

		test("accepts valid non-blacklisted JTI", async () => {
			const address = "GPLAYER2";
			const jti = "valid-jti";
			const token = jwt.sign(
				{ address, sub: address },
				JWT_SECRET,
				{ jwtid: jti, expiresIn: "7d" },
			);

			mockReq = {
				headers: {
					authorization: `Bearer ${token}`,
				},
				socket: {
					remoteAddress: "192.168.1.100",
				},
			};

			await requireAuth(mockReq, mockRes, mockNext);

			expect(mockNext).toHaveBeenCalled();
			expect(mockRes.status).not.toHaveBeenCalled();
			expect(mockReq.user.address).toBe(address);
		});
	});

	describe("requireAuth - IP Subnet Binding Validation", () => {
		test("accepts request from same IP subnet as token binding", async () => {
			const address = "GPLAYER3";
			const ipSubnet = "192.168.1";
			const token = jwt.sign(
				{ address, sub: address, ipSubnet },
				JWT_SECRET,
				{ jwtid: jwt.sign({ x: 1 }, JWT_SECRET).split(".")[2], expiresIn: "7d" },
			);

			mockReq = {
				headers: {
					authorization: `Bearer ${token}`,
				},
				socket: {
					remoteAddress: "192.168.1.100",
				},
			};

			await requireAuth(mockReq, mockRes, mockNext);

			expect(mockNext).toHaveBeenCalled();
			expect(mockRes.status).not.toHaveBeenCalled();
		});

		test("rejects request from different IP subnet with 401", async () => {
			const address = "GPLAYER4";
			const boundIpSubnet = "192.168.1";
			const token = jwt.sign(
				{ address, sub: address, ipSubnet: boundIpSubnet },
				JWT_SECRET,
				{ jwtid: "test-jti", expiresIn: "7d" },
			);

			mockReq = {
				headers: {
					authorization: `Bearer ${token}`,
				},
				socket: {
					remoteAddress: "192.168.2.100", // Different subnet
				},
			};

			await requireAuth(mockReq, mockRes, mockNext);

			expect(mockRes.status).toHaveBeenCalledWith(401);
			expect(mockRes.json).toHaveBeenCalledWith({
				success: false,
				error: "Session IP mismatch - please re-authenticate",
			});
			expect(mockNext).not.toHaveBeenCalled();
		});

		test("allows localhost bypass for testing", async () => {
			const address = "GPLAYER5";
			const boundIpSubnet = "127.0.0"; // localhost subnet
			const token = jwt.sign(
				{ address, sub: address, ipSubnet: boundIpSubnet },
				JWT_SECRET,
				{ jwtid: "test-jti", expiresIn: "7d" },
			);

			mockReq = {
				headers: {
					authorization: `Bearer ${token}`,
				},
				socket: {
					remoteAddress: "127.0.0.1",
				},
			};

			await requireAuth(mockReq, mockRes, mockNext);

			expect(mockNext).toHaveBeenCalled();
			expect(mockRes.status).not.toHaveBeenCalled();
		});

		test("works with X-Forwarded-For header for IP extraction", async () => {
			const address = "GPLAYER6";
			const ipSubnet = "203.0.113";
			const token = jwt.sign(
				{ address, sub: address, ipSubnet },
				JWT_SECRET,
				{ jwtid: "test-jti", expiresIn: "7d" },
			);

			mockReq = {
				headers: {
					authorization: `Bearer ${token}`,
					"x-forwarded-for": "203.0.113.100, 192.0.2.1",
				},
			};

			await requireAuth(mockReq, mockRes, mockNext);

			expect(mockNext).toHaveBeenCalled();
			expect(mockRes.status).not.toHaveBeenCalled();
		});

		test("rejects on X-Forwarded-For IP mismatch", async () => {
			const address = "GPLAYER7";
			const boundIpSubnet = "203.0.113";
			const token = jwt.sign(
				{ address, sub: address, ipSubnet: boundIpSubnet },
				JWT_SECRET,
				{ jwtid: "test-jti", expiresIn: "7d" },
			);

			mockReq = {
				headers: {
					authorization: `Bearer ${token}`,
					"x-forwarded-for": "198.51.100.50, 192.0.2.1", // Different subnet
				},
			};

			await requireAuth(mockReq, mockRes, mockNext);

			expect(mockRes.status).toHaveBeenCalledWith(401);
			expect(mockNext).not.toHaveBeenCalled();
		});

		test("allows request without IP binding (null ipSubnet)", async () => {
			const address = "GPLAYER8";
			const token = jwt.sign(
				{ address, sub: address }, // No ipSubnet claim
				JWT_SECRET,
				{ jwtid: "test-jti", expiresIn: "7d" },
			);

			mockReq = {
				headers: {
					authorization: `Bearer ${token}`,
				},
				socket: {
					remoteAddress: "any.ip.address.here",
				},
			};

			await requireAuth(mockReq, mockRes, mockNext);

			expect(mockNext).toHaveBeenCalled();
			expect(mockRes.status).not.toHaveBeenCalled();
		});
	});

	describe("requireAuth - Combined Validation", () => {
		test("validates both JTI blacklist and IP binding", async () => {
			const address = "GPLAYER9";
			const ipSubnet = "192.168.1";
			const token = jwt.sign(
				{ address, sub: address, ipSubnet },
				JWT_SECRET,
				{ jwtid: "test-jti", expiresIn: "7d" },
			);

			mockReq = {
				headers: {
					authorization: `Bearer ${token}`,
				},
				socket: {
					remoteAddress: "192.168.1.100",
				},
			};

			// First request should succeed
			await requireAuth(mockReq, mockRes, mockNext);
			expect(mockNext).toHaveBeenCalled();

			// Reset mocks
			mockNext.mockClear();
			mockRes.status.mockClear();
			mockRes.json.mockClear();

			// Second request with different IP should fail
			mockReq.socket.remoteAddress = "192.168.2.100";
			await requireAuth(mockReq, mockRes, mockNext);

			expect(mockRes.status).toHaveBeenCalledWith(401);
			expect(mockNext).not.toHaveBeenCalled();
		});
	});

	describe("optionalAuth - IP Binding Validation", () => {
		test("does not attach user on IP mismatch", async () => {
			const address = "GPLAYER10";
			const boundIpSubnet = "192.168.1";
			const token = jwt.sign(
				{ address, sub: address, ipSubnet: boundIpSubnet },
				JWT_SECRET,
				{ jwtid: "test-jti", expiresIn: "7d" },
			);

			mockReq = {
				headers: {
					authorization: `Bearer ${token}`,
				},
				socket: {
					remoteAddress: "192.168.2.100", // Different subnet
				},
			};

			await optionalAuth(mockReq, mockRes, mockNext);

			expect(mockNext).toHaveBeenCalled();
			expect(mockReq.user).toBeUndefined();
		});

		test("attaches user on IP match for optional auth", async () => {
			const address = "GPLAYER11";
			const ipSubnet = "192.168.1";
			const token = jwt.sign(
				{ address, sub: address, ipSubnet },
				JWT_SECRET,
				{ jwtid: "test-jti", expiresIn: "7d" },
			);

			mockReq = {
				headers: {
					authorization: `Bearer ${token}`,
				},
				socket: {
					remoteAddress: "192.168.1.100",
				},
			};

			await optionalAuth(mockReq, mockRes, mockNext);

			expect(mockNext).toHaveBeenCalled();
			expect(mockReq.user.address).toBe(address);
		});

		test("ignores missing or malformed auth on optional auth", async () => {
			mockReq = {
				headers: {},
			};

			await optionalAuth(mockReq, mockRes, mockNext);

			expect(mockNext).toHaveBeenCalled();
			expect(mockReq.user).toBeUndefined();
		});
	});

	describe("Edge Cases", () => {
		test("handles missing Bearer token gracefully", async () => {
			mockReq = {
				headers: {
					authorization: "Invalid",
				},
			};

			await requireAuth(mockReq, mockRes, mockNext);

			expect(mockRes.status).toHaveBeenCalledWith(401);
			expect(mockRes.json).toHaveBeenCalledWith({
				success: false,
				error: "Missing or malformed Authorization header",
			});
		});

		test("handles expired token", async () => {
			const address = "GPLAYER12";
			const token = jwt.sign(
				{ address, sub: address },
				JWT_SECRET,
				{ jwtid: "test-jti", expiresIn: "0s" }, // Already expired
			);

			// Give it a moment for the token to definitely be expired
			await new Promise((resolve) => setTimeout(resolve, 100));

			mockReq = {
				headers: {
					authorization: `Bearer ${token}`,
				},
			};

			await requireAuth(mockReq, mockRes, mockNext);

			expect(mockRes.status).toHaveBeenCalledWith(401);
			expect(mockRes.json).toHaveBeenCalledWith({
				success: false,
				error: "Token expired",
			});
		});

		test("handles missing Authorization header", async () => {
			mockReq = {
				headers: {},
			};

			await requireAuth(mockReq, mockRes, mockNext);

			expect(mockRes.status).toHaveBeenCalledWith(401);
			expect(mockRes.json).toHaveBeenCalledWith({
				success: false,
				error: "Missing or malformed Authorization header",
			});
		});
	});
});
