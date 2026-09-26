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
