/**
 * Tests for the HTTPS/WSS transport enforcement middleware (Issue #143).
 */

const {
	enforceHttps,
	enforceSecureSocket,
	isEnforcementEnabled,
	resolveProtocol,
} = require("../middleware/enforceHttps");

function mockReq(overrides = {}) {
	return {
		method: "GET",
		protocol: "http",
		originalUrl: "/api/test",
		headers: { host: "chesster.app" },
		...overrides,
	};
}

function mockRes() {
	const res = {};
	res.statusCode = null;
	res.headers = {};
	res.setHeader = jest.fn((k, v) => {
		res.headers[k] = v;
	});
	res.redirect = jest.fn();
	res.status = jest.fn().mockReturnValue(res);
	res.json = jest.fn().mockReturnValue(res);
	return res;
}

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
	process.env = { ...ORIGINAL_ENV };
	jest.clearAllMocks();
});

describe("resolveProtocol", () => {
	it("prefers the first value of X-Forwarded-Proto", () => {
		const req = mockReq({ headers: { "x-forwarded-proto": "https, http" } });
		expect(resolveProtocol(req)).toBe("https");
	});

	it("falls back to req.protocol when no forwarded header", () => {
		expect(resolveProtocol(mockReq({ protocol: "HTTP" }))).toBe("http");
	});
});

describe("enforceHttps in production", () => {
	beforeEach(() => {
		process.env.NODE_ENV = "production";
		delete process.env.DISABLE_HTTPS_REDIRECT;
	});

	it("passes secure requests through and sets HSTS (happy path)", () => {
		const req = mockReq({ headers: { host: "chesster.app", "x-forwarded-proto": "https" } });
		const res = mockRes();
		const next = jest.fn();

		enforceHttps(req, res, next);

		expect(next).toHaveBeenCalledTimes(1);
		expect(res.headers["Strict-Transport-Security"]).toContain("max-age=31536000");
		expect(res.redirect).not.toHaveBeenCalled();
	});

	it("301-redirects insecure GET requests to HTTPS", () => {
		const req = mockReq({ headers: { host: "chesster.app", "x-forwarded-proto": "http" } });
		const res = mockRes();
		const next = jest.fn();

		enforceHttps(req, res, next);

		expect(res.redirect).toHaveBeenCalledWith(301, "https://chesster.app/api/test");
		expect(next).not.toHaveBeenCalled();
	});

	it("refuses insecure non-GET requests with 403 (no body-dropping redirect)", () => {
		const req = mockReq({ method: "POST", headers: { host: "chesster.app", "x-forwarded-proto": "http" } });
		const res = mockRes();
		const next = jest.fn();

		enforceHttps(req, res, next);

		expect(res.status).toHaveBeenCalledWith(403);
		expect(res.json).toHaveBeenCalledWith({ error: "HTTPS is required" });
		expect(next).not.toHaveBeenCalled();
	});
});

describe("enforceHttps outside production", () => {
	it("is a no-op in development", () => {
		process.env.NODE_ENV = "development";
		const req = mockReq({ headers: { host: "localhost", "x-forwarded-proto": "http" } });
		const res = mockRes();
		const next = jest.fn();

		enforceHttps(req, res, next);

		expect(next).toHaveBeenCalledTimes(1);
		expect(res.redirect).not.toHaveBeenCalled();
	});

	it("honors the DISABLE_HTTPS_REDIRECT escape hatch in production", () => {
		process.env.NODE_ENV = "production";
		process.env.DISABLE_HTTPS_REDIRECT = "true";
		expect(isEnforcementEnabled()).toBe(false);

		const req = mockReq({ headers: { host: "chesster.app", "x-forwarded-proto": "http" } });
		const res = mockRes();
		const next = jest.fn();

		enforceHttps(req, res, next);
		expect(next).toHaveBeenCalledTimes(1);
	});
});

describe("enforceSecureSocket in production", () => {
	beforeEach(() => {
		process.env.NODE_ENV = "production";
		delete process.env.DISABLE_HTTPS_REDIRECT;
	});

	it("accepts a wss (https-forwarded) handshake", () => {
		const guard = enforceSecureSocket();
		const socket = { handshake: { headers: { "x-forwarded-proto": "https" }, secure: false } };
		const next = jest.fn();

		guard(socket, next);
		expect(next).toHaveBeenCalledWith();
	});

	it("rejects an insecure (ws) handshake", () => {
		const guard = enforceSecureSocket();
		const socket = { handshake: { headers: { "x-forwarded-proto": "http" }, secure: false } };
		const next = jest.fn();

		guard(socket, next);
		expect(next).toHaveBeenCalledTimes(1);
		expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
		expect(next.mock.calls[0][0].message).toMatch(/wss/i);
	});

	it("is a no-op in development", () => {
		process.env.NODE_ENV = "development";
		const guard = enforceSecureSocket();
		const socket = { handshake: { headers: {}, secure: false } };
		const next = jest.fn();

		guard(socket, next);
		expect(next).toHaveBeenCalledWith();
	});
});
