process.env.JWT_SECRET = "test-secret";

const jwt = require("jsonwebtoken");
const { requireAuth, optionalAuth } = require("../middleware/authMiddleware");

function mockRes() {
	const res = {};
	res.status = jest.fn().mockReturnValue(res);
	res.json = jest.fn().mockReturnValue(res);
	return res;
}

describe("authMiddleware", () => {
	describe("requireAuth", () => {
		it("rejects requests with no Authorization header", () => {
			const req = { headers: {} };
			const res = mockRes();
			const next = jest.fn();

			requireAuth(req, res, next);

			expect(res.status).toHaveBeenCalledWith(401);
			expect(next).not.toHaveBeenCalled();
		});

		it("rejects a malformed Authorization header", () => {
			const req = { headers: { authorization: "Basic abc123" } };
			const res = mockRes();
			const next = jest.fn();

			requireAuth(req, res, next);

			expect(res.status).toHaveBeenCalledWith(401);
			expect(next).not.toHaveBeenCalled();
		});

		it("rejects an invalid/garbage token", () => {
			const req = { headers: { authorization: "Bearer not-a-real-token" } };
			const res = mockRes();
			const next = jest.fn();

			requireAuth(req, res, next);

			expect(res.status).toHaveBeenCalledWith(401);
			expect(next).not.toHaveBeenCalled();
		});

		it("rejects an expired token", () => {
			const token = jwt.sign({ address: "GABC" }, "test-secret", { expiresIn: -10 });
			const req = { headers: { authorization: `Bearer ${token}` } };
			const res = mockRes();
			const next = jest.fn();

			requireAuth(req, res, next);

			expect(res.status).toHaveBeenCalledWith(401);
			expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: "Token expired" }));
			expect(next).not.toHaveBeenCalled();
		});

		it("attaches req.user and calls next() for a valid token", () => {
			const token = jwt.sign({ address: "GABCDEF" }, "test-secret", { expiresIn: "1h" });
			const req = { headers: { authorization: `Bearer ${token}` } };
			const res = mockRes();
			const next = jest.fn();

			requireAuth(req, res, next);

			expect(next).toHaveBeenCalled();
			expect(req.user.address).toBe("GABCDEF");
		});
	});

	describe("optionalAuth", () => {
		it("calls next() without req.user when no token is present", () => {
			const req = { headers: {} };
			const res = mockRes();
			const next = jest.fn();

			optionalAuth(req, res, next);

			expect(next).toHaveBeenCalled();
			expect(req.user).toBeUndefined();
		});

		it("attaches req.user when a valid token is present", () => {
			const token = jwt.sign({ address: "GXYZ" }, "test-secret", { expiresIn: "1h" });
			const req = { headers: { authorization: `Bearer ${token}` } };
			const res = mockRes();
			const next = jest.fn();

			optionalAuth(req, res, next);

			expect(next).toHaveBeenCalled();
			expect(req.user.address).toBe("GXYZ");
		});

		it("calls next() even when the token is invalid", () => {
			const req = { headers: { authorization: "Bearer garbage" } };
			const res = mockRes();
			const next = jest.fn();

			optionalAuth(req, res, next);

			expect(next).toHaveBeenCalled();
			expect(req.user).toBeUndefined();
		});
	});
});
