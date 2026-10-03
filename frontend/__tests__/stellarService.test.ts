import { describe, it, expect, vi } from "vitest";

// The stellar SDK and Freighter wallet API are mocked so importing the service
// never performs network or wallet I/O. Freighter's signTransaction is the only
// component that ever touches secrets, and it lives entirely in the extension.
vi.mock("@stellar/stellar-sdk", () => ({
	rpc: { Server: class { constructor() {} } },
	TransactionBuilder: class {},
	Networks: { TESTNET: "Test SDF Network ; September 2015" },
	Contract: class {},
	nativeToScVal: vi.fn(),
	Transaction: class {},
}));

vi.mock("@stellar/freighter-api", () => ({
	signTransaction: vi.fn(),
}));

import { assertNoSecretKey, assertValidPublicKey, depositXLM } from "../src/services/stellarService";

const VALID_PUBLIC_KEY = "G" + "A".repeat(55);
const SECRET_KEY = "S" + "A".repeat(55);

describe("assertNoSecretKey", () => {
	it("accepts a public key without throwing (happy path)", () => {
		expect(() => assertNoSecretKey(VALID_PUBLIC_KEY)).not.toThrow();
	});

	it("throws when handed a Stellar secret seed", () => {
		expect(() => assertNoSecretKey(SECRET_KEY)).toThrow(
			"Secret keys must never be handled by the client",
		);
	});
});

describe("assertValidPublicKey", () => {
	it("returns a well-formed public key unchanged", () => {
		expect(assertValidPublicKey(VALID_PUBLIC_KEY)).toBe(VALID_PUBLIC_KEY);
	});

	it("rejects a secret seed passed where a public key is expected", () => {
		expect(() => assertValidPublicKey(SECRET_KEY)).toThrow(
			"Secret keys must never be handled by the client",
		);
	});

	it.each([
		["a too-short value", "GABC"],
		["lowercase characters", "g" + "a".repeat(55)],
		["an empty string", ""],
		["a muxed/invalid prefix", "M" + "A".repeat(55)],
	])("rejects %s", (_label, value) => {
		expect(() => assertValidPublicKey(value)).toThrow("Invalid Stellar public key");
	});
});

describe("depositXLM secret-key isolation", () => {
	it("rejects a secret key before any network call (exploit simulation)", async () => {
		await expect(
			depositXLM("create_match", "GAME1", "1.0", SECRET_KEY),
		).rejects.toThrow("Secret keys must never be handled by the client");
	});

	it("rejects a malformed public key before any network call", async () => {
		await expect(
			depositXLM("join_match", "GAME1", "1.0", "not-a-key"),
		).rejects.toThrow("Invalid Stellar public key");
import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchAccountBalances } from "../src/services/stellarService";

const ADDRESS = "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV";

function mockFetchOnce(response: Partial<Response> & { json?: () => Promise<unknown> }) {
	vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response as Response);
}

describe("fetchAccountBalances", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("throws when no public key is provided", async () => {
		await expect(fetchAccountBalances("")).rejects.toThrow(
			"A public key is required to fetch balances",
		);
	});

	it("maps Horizon's native balance to an XLM entry", async () => {
		mockFetchOnce({
			ok: true,
			status: 200,
			json: async () => ({
				balances: [{ asset_type: "native", balance: "12.4550000" }],
			}),
		});

		const balances = await fetchAccountBalances(ADDRESS);

		expect(balances).toEqual([{ assetCode: "XLM", balance: "12.4550000", assetIssuer: undefined }]);
	});

	it("maps non-native (SAC) balances with their asset code and issuer", async () => {
		mockFetchOnce({
			ok: true,
			status: 200,
			json: async () => ({
				balances: [
					{ asset_type: "native", balance: "5.0000000" },
					{
						asset_type: "credit_alphanum4",
						asset_code: "USDC",
						asset_issuer: "GISSUER",
						balance: "100.0000000",
					},
				],
			}),
		});

		const balances = await fetchAccountBalances(ADDRESS);

		expect(balances).toEqual([
			{ assetCode: "XLM", balance: "5.0000000", assetIssuer: undefined },
			{ assetCode: "USDC", balance: "100.0000000", assetIssuer: "GISSUER" },
		]);
	});

	it("treats an unfunded account (404) as a zero XLM balance rather than an error", async () => {
		mockFetchOnce({ ok: false, status: 404 });

		const balances = await fetchAccountBalances(ADDRESS);

		expect(balances).toEqual([{ assetCode: "XLM", balance: "0" }]);
	});

	it("throws a descriptive error for other non-OK responses", async () => {
		mockFetchOnce({ ok: false, status: 500 });

		await expect(fetchAccountBalances(ADDRESS)).rejects.toThrow(
			"Failed to fetch account balances (status 500)",
		);
	});

	it("wraps network failures in a friendly error", async () => {
		vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network down"));

		await expect(fetchAccountBalances(ADDRESS)).rejects.toThrow(
			"Unable to reach the Stellar network to fetch balances",
		);
	});

	it("defaults to an empty balances array when Horizon omits the field", async () => {
		mockFetchOnce({ ok: true, status: 200, json: async () => ({}) });

		const balances = await fetchAccountBalances(ADDRESS);

		expect(balances).toEqual([]);
	});
});
