import { describe, it, expect, vi, afterEach } from "vitest";

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
	});
});

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

import { mapWalletError } from "../src/services/stellarService";

describe("mapWalletError", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("user rejection / cancellation", () => {
		it.each([
			["user rejected", "User rejected the transaction"],
			["user denied", "User denied signing"],
			["user cancelled", "User cancelled in Freighter"],
			["rejected (capitalized)", "Rejected"],
			["denied (capitalized)", "Denied"],
			["REJECTED (all caps)", "REJECTED"],
		])("maps '%s' to user_rejection", (_label, message) => {
			const result = mapWalletError(new Error(message));
			expect(result.category).toBe("user_rejection");
			expect(result.message).toContain("cancelled");
			expect(result.message).not.toContain("raw");
			expect(result.message).not.toContain("stack");
		});

		it("detects user_rejection in error code (case-insensitive)", () => {
			const result = mapWalletError({ code: "USER_REJECTION" });
			expect(result.category).toBe("user_rejection");
		});
	});

	describe("insufficient balance", () => {
		it.each([
			["insufficient XLM", "Insufficient XLM balance"],
			["insufficient balance", "Account has insufficient balance"],
			["insufficient_balance (snake_case)", "insufficient_balance"],
			["no_trust", "no_trust operation failed"],
			["op_no_trust", "op_no_trust code"],
			["underfunded", "The account is underfunded"],
			["insufficient fee", "Insufficient fee"],
			["tx_insufficient_balance", "tx_insufficient_balance"],
		])("maps '%s' to insufficient_balance", (_label, message) => {
			const result = mapWalletError(new Error(message));
			expect(result.category).toBe("insufficient_balance");
			expect(result.message).toContain("Insufficient");
			expect(result.message).toContain("balance");
		});

		it("detects insufficient_balance in error code (case-insensitive)", () => {
			const result = mapWalletError({ code: "INSUFFICIENT_BALANCE" });
			expect(result.category).toBe("insufficient_balance");
		});
	});

	describe("timeout / network / RPC errors", () => {
		it.each([
			["timeout", "Request timed out"],
			["timed out", "Connection timed out"],
			["TRY_AGAIN_LATER", "try_again_later"],
			["504 error", "504 Gateway Timeout"],
			["503 error", "503 Service Unavailable"],
			["unable to reach", "Unable to reach Stellar network"],
			["network error", "Network error occurred"],
			["econnrefused", "ECONNREFUSED"],
			["enotfound", "ENOTFOUND"],
		])("maps '%s' to timeout", (_label, message) => {
			const result = mapWalletError(new Error(message));
			expect(result.category).toBe("timeout");
			expect(result.message).toContain("timeout");
		});

		it("detects timeout in error code (case-insensitive)", () => {
			const result = mapWalletError({ code: "TIMEOUT" });
			expect(result.category).toBe("timeout");
		});
	});

	describe("wallet not installed or locked", () => {
		it.each([
			["not installed", "Freighter is not installed"],
			["wallet not found", "Wallet not found"],
			["wallet locked", "Wallet is locked"],
			["not connected", "Wallet not connected"],
			["not enabled", "Extension not enabled"],
		])("maps '%s' to wallet_issue", (_label, message) => {
			const result = mapWalletError(new Error(message));
			expect(result.category).toBe("wallet_issue");
			expect(result.message).toContain("Freighter");
		});

		it("detects wallet_issue in error code (case-insensitive)", () => {
			const result = mapWalletError({ code: "WALLET_NOT_FOUND" });
			expect(result.category).toBe("wallet_issue");
		});
	});

	describe("sequence / validation errors", () => {
		it.each([
			["bad sequence", "bad_seq"],
			["txBAD_SEQ", "txBAD_SEQ"],
			["sequence error", "bad sequence number"],
			["invalid XDR", "invalid xdr format"],
		])("maps '%s' to network_error", (_label, message) => {
			const result = mapWalletError(new Error(message));
			expect(result.category).toBe("network_error");
		});
	});

	describe("HTTP status code errors", () => {
		it.each([
			[400, "Bad Request"],
			[403, "Forbidden"],
			[404, "Not Found"],
			[500, "Internal Server Error"],
			[503, "Service Unavailable"],
		])("maps HTTP %d status to network_error", (status, _msg) => {
			const result = mapWalletError({ status });
			expect(result.category).toBe("network_error");
		});
	});

	describe("fallback to unknown for unrecognized errors", () => {
		it("provides a safe fallback message for completely unknown errors", () => {
			const result = mapWalletError(new Error("some weird error"));
			expect(result.category).toBe("unknown");
			expect(result.message).toContain("Transaction failed");
			expect(result.message).not.toContain("weird");
			expect(result.message).not.toContain("stack");
		});

		it("handles null gracefully", () => {
			const result = mapWalletError(null);
			expect(result.category).toBe("unknown");
			expect(result.message).toContain("Transaction failed");
		});

		it("handles undefined gracefully", () => {
			const result = mapWalletError(undefined);
			expect(result.category).toBe("unknown");
			expect(result.message).toContain("Transaction failed");
		});

		it("handles non-Error objects (plain object)", () => {
			const result = mapWalletError({ foo: "bar" });
			expect(result.category).toBe("unknown");
			expect(result.message).toContain("Transaction failed");
		});

		it("handles string throwables", () => {
			const result = mapWalletError("some string error");
			expect(result.category).toBe("unknown");
			expect(result.message).toContain("Transaction failed");
		});

		it("handles number throwables", () => {
			const result = mapWalletError(42);
			expect(result.category).toBe("unknown");
			expect(result.message).toContain("Transaction failed");
		});
	});

	describe("no leakage of internals", () => {
		it("never includes raw XDR in user-facing message", () => {
			const xdrStuff = "AAAAAgAAAABfCAAAAA...";
			const result = mapWalletError(new Error(`XDR: ${xdrStuff}`));
			expect(result.message).not.toContain(xdrStuff);
			expect(result.message).not.toContain("XDR");
		});

		it("never includes raw stack traces in user-facing message", () => {
			const err = new Error("some error");
			const result = mapWalletError(err);
			expect(result.message).not.toContain("at ");
			expect(result.message).not.toContain("stellarService");
		});

		it("never includes wallet addresses in user-facing message", () => {
			const address = "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV";
			const result = mapWalletError(new Error(`Address ${address} has insufficient balance`));
			expect(result.message).not.toContain(address.substring(0, 10));
		});

		it("logs full error to console for debugging but doesn't expose to user", () => {
			const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
			const err = new Error("detailed error info");
			mapWalletError(err);
			expect(consoleSpy).toHaveBeenCalledWith("[Wallet Error]", err);
			consoleSpy.mockRestore();
		});
	});

	describe("case-insensitive matching", () => {
		it("matches error messages case-insensitively", () => {
			const result1 = mapWalletError(new Error("REJECTED"));
			const result2 = mapWalletError(new Error("rejected"));
			const result3 = mapWalletError(new Error("Rejected"));
			expect(result1.category).toBe("user_rejection");
			expect(result2.category).toBe("user_rejection");
			expect(result3.category).toBe("user_rejection");
		});

		it("matches error codes case-insensitively", () => {
			const result1 = mapWalletError({ code: "INSUFFICIENT_BALANCE" });
			const result2 = mapWalletError({ code: "insufficient_balance" });
			const result3 = mapWalletError({ code: "Insufficient_Balance" });
			expect(result1.category).toBe("insufficient_balance");
			expect(result2.category).toBe("insufficient_balance");
			expect(result3.category).toBe("insufficient_balance");
		});
	});

	describe("complex / realistic error objects", () => {
		it("extracts message from error.message field", () => {
			const result = mapWalletError({ message: "User rejected" });
			expect(result.category).toBe("user_rejection");
		});

		it("extracts message from error.msg field (alternative)", () => {
			const result = mapWalletError({ msg: "insufficient balance" });
			expect(result.category).toBe("insufficient_balance");
		});

		it("extracts message from error.detail field (another alternative)", () => {
			const result = mapWalletError({ detail: "timeout" });
			expect(result.category).toBe("timeout");
		});

		it("prioritizes error.message over error.msg over error.detail", () => {
			const result = mapWalletError({
				message: "User rejected",
				msg: "insufficient balance",
				detail: "timeout",
			});
			expect(result.category).toBe("user_rejection");
		});

		it("handles RPC error response with status field", () => {
			const result = mapWalletError({
				status: 503,
				message: "Service unavailable",
			});
			expect(result.category).toBe("network_error");
		});
	});
});
