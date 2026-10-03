jest.mock("@stellar/stellar-sdk", () => {
	let counter = 0;
	return {
		Keypair: {
			random() {
				counter += 1;
				const addr = `GTEST${String(counter).padStart(4, "0")}`;
				return {
					publicKey: () => addr,
					sign: (msg) => Buffer.from(`sig:${msg.toString("utf8")}`, "utf8"),
				};
			},
			fromPublicKey(address) {
				return {
					verify: (msg, sig) =>
						sig.toString("utf8") === `sig:${msg.toString("utf8")}` &&
						msg.toString("utf8").includes(address),
				};
			},
		},
	};
});

const { Keypair } = require("@stellar/stellar-sdk");

const AuthServiceClass = require("../services/authService").AuthService;

function makeService(overrides = {}) {
	let now = 1_000_000;
	const svc = new AuthServiceClass({
		ttlMs: 1000,
		maxEntries: 3,
		sweepIntervalMs: 0, // no background timer in tests
		autoSweep: false,
		now: () => now,
		...overrides,
	});
	return {
		svc,
		get now() {
			return now;
		},
		advance(ms) {
			now += ms;
		},
	};
}

function signMessage(kp, message) {
	return Buffer.from(kp.sign(Buffer.from(message, "utf8"))).toString("base64");
}

describe("authService challenge bounds", () => {
	test("one active challenge per address: re-issue invalidates the previous nonce", () => {
		const { svc } = makeService();
		const kp = Keypair.random();
		const first = svc.createChallenge(kp.publicKey());
		const second = svc.createChallenge(kp.publicKey());
		expect(second).not.toBe(first);
		expect(svc.size).toBe(1);
		// Old message signature must fail against the replaced challenge.
		const staleSig = signMessage(kp, first);
		expect(() => svc.verifySignature(kp.publicKey(), staleSig)).toThrow(
			"Signature verification failed",
		);
		// Current message verifies and is single-use.
		const freshSig = signMessage(kp, second);
		expect(svc.verifySignature(kp.publicKey(), freshSig)).toBe(true);
		expect(() => svc.verifySignature(kp.publicKey(), freshSig)).toThrow(
			"No pending login challenge",
		);
		svc.stop();
	});

	test("expired entries are pruned without client action", () => {
		const ctx = makeService({ ttlMs: 500 });
		const a = Keypair.random().publicKey();
		const b = Keypair.random().publicKey();
		ctx.svc.createChallenge(a);
		ctx.svc.createChallenge(b);
		expect(ctx.svc.size).toBe(2);
		ctx.advance(501);
		expect(ctx.svc.pruneExpired()).toBe(2);
		expect(ctx.svc.size).toBe(0);
		expect(() => ctx.svc.verifySignature(a, "eA==")).toThrow("No pending login challenge");
		ctx.svc.stop();
	});

	test("verify rejects expired challenge and removes it", () => {
		const ctx = makeService({ ttlMs: 500 });
		const kp = Keypair.random();
		const message = ctx.svc.createChallenge(kp.publicKey());
		ctx.advance(501);
		expect(() => ctx.svc.verifySignature(kp.publicKey(), signMessage(kp, message))).toThrow(
			"expired",
		);
		expect(ctx.svc.size).toBe(0);
		ctx.svc.stop();
	});

	test("capacity is bounded: oldest entry evicted when full", () => {
		const ctx = makeService({ ttlMs: 60_000, maxEntries: 2 });
		const addrs = [Keypair.random().publicKey(), Keypair.random().publicKey(), Keypair.random().publicKey()];
		addrs.forEach((a) => ctx.svc.createChallenge(a));
		expect(ctx.svc.size).toBe(2);
		expect(ctx.svc.challenges.has(addrs[0])).toBe(false); // oldest evicted
		expect(ctx.svc.challenges.has(addrs[2])).toBe(true);
		ctx.svc.stop();
	});

	test("expired entries are preferred for eviction on create", () => {
		const ctx = makeService({ ttlMs: 500, maxEntries: 2 });
		const a = Keypair.random().publicKey();
		const b = Keypair.random().publicKey();
		const c = Keypair.random().publicKey();
		ctx.svc.createChallenge(a);
		ctx.svc.createChallenge(b);
		ctx.advance(501); // both expired
		ctx.svc.createChallenge(c);
		expect(ctx.svc.size).toBe(1);
		expect(ctx.svc.challenges.has(c)).toBe(true);
		ctx.svc.stop();
	});
});
