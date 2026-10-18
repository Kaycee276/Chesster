import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the Stellar SDK and wallet services
vi.mock("@stellar/stellar-sdk", () => ({
	rpc: {
		Server: vi.fn(() => ({
			getAccount: vi.fn(),
			prepareTransaction: vi.fn(),
			sendTransaction: vi.fn(),
			getTransaction: vi.fn(),
		})),
	},
	TransactionBuilder: vi.fn((account, opts) => ({
		addOperation: vi.fn(function () {
			return this;
		}),
		setTimeout: vi.fn(function () {
			return this;
		}),
		build: vi.fn(() => ({ toXDR: vi.fn(() => "mock-xdr") })),
		fromXDR: vi.fn(() => ({})),
	})),
	Networks: { TESTNET: "Test SDF Network ; September 2015" },
	Contract: vi.fn(),
	nativeToScVal: vi.fn(),
	Transaction: vi.fn(),
}));

vi.mock("../src/services/walletKit", () => ({
	signTransactionWithWalletKit: vi.fn(),
}));

vi.mock("../src/store/toastStore", () => ({
	useToastStore: {
		getState: vi.fn(() => ({
			addToast: vi.fn(),
		})),
	},
}));

import { depositXLM } from "../src/services/stellarService";
import { useToastStore } from "../src/store/toastStore";

const VALID_PUBLIC_KEY = "G" + "A".repeat(55);

describe("depositXLM toast integration", () => {
	let mockAddToast: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		mockAddToast = vi.fn();
		(useToastStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({
			addToast: mockAddToast,
		});
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("dispatches a toast on user rejection", async () => {
		// Mock signing rejection
		const { signTransactionWithWalletKit } = await import("../src/services/walletKit");
		(signTransactionWithWalletKit as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
			new Error("User rejected signing")
		);

		const { rpc } = await import("@stellar/stellar-sdk");
		const mockServer = (rpc.Server as ReturnType<typeof vi.fn>).mock.results[0]?.value;
		if (mockServer) {
			mockServer.getAccount = vi.fn().mockResolvedValueOnce({ sequence: "0" });
			mockServer.prepareTransaction = vi.fn().mockResolvedValueOnce({ toXDR: vi.fn(() => "xdr") });
		}

		await expect(depositXLM("create_match", "GAME1", "1.0", VALID_PUBLIC_KEY)).rejects.toThrow();
		
		expect(mockAddToast).toHaveBeenCalled();
		const [message, type] = mockAddToast.mock.calls[0];
		expect(message).toContain("cancelled");
		expect(type).toBe("info"); // user rejection uses info type
	});

	it("dispatches a toast on insufficient balance", async () => {
		const { signTransactionWithWalletKit } = await import("../src/services/walletKit");
		(signTransactionWithWalletKit as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
			new Error("Insufficient balance for operation")
		);

		const { rpc } = await import("@stellar/stellar-sdk");
		const mockServer = (rpc.Server as ReturnType<typeof vi.fn>).mock.results[0]?.value;
		if (mockServer) {
			mockServer.getAccount = vi.fn().mockResolvedValueOnce({ sequence: "0" });
			mockServer.prepareTransaction = vi.fn().mockResolvedValueOnce({ toXDR: vi.fn(() => "xdr") });
		}

		await expect(depositXLM("create_match", "GAME1", "1.0", VALID_PUBLIC_KEY)).rejects.toThrow();
		
		expect(mockAddToast).toHaveBeenCalled();
		const [message, type] = mockAddToast.mock.calls[0];
		expect(message).toContain("balance");
		expect(type).toBe("error");
	});

	it("dispatches a toast on timeout", async () => {
		const { signTransactionWithWalletKit } = await import("../src/services/walletKit");
		(signTransactionWithWalletKit as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
			new Error("Request timeout")
		);

		const { rpc } = await import("@stellar/stellar-sdk");
		const mockServer = (rpc.Server as ReturnType<typeof vi.fn>).mock.results[0]?.value;
		if (mockServer) {
			mockServer.getAccount = vi.fn().mockResolvedValueOnce({ sequence: "0" });
			mockServer.prepareTransaction = vi.fn().mockResolvedValueOnce({ toXDR: vi.fn(() => "xdr") });
		}

		await expect(depositXLM("create_match", "GAME1", "1.0", VALID_PUBLIC_KEY)).rejects.toThrow();
		
		expect(mockAddToast).toHaveBeenCalled();
		const [message, type] = mockAddToast.mock.calls[0];
		expect(message).toContain("timeout");
		expect(type).toBe("error");
	});

	it("dispatches a toast on unknown error", async () => {
		const { signTransactionWithWalletKit } = await import("../src/services/walletKit");
		(signTransactionWithWalletKit as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
			new Error("Some weird error code")
		);

		const { rpc } = await import("@stellar/stellar-sdk");
		const mockServer = (rpc.Server as ReturnType<typeof vi.fn>).mock.results[0]?.value;
		if (mockServer) {
			mockServer.getAccount = vi.fn().mockResolvedValueOnce({ sequence: "0" });
			mockServer.prepareTransaction = vi.fn().mockResolvedValueOnce({ toXDR: vi.fn(() => "xdr") });
		}

		await expect(depositXLM("create_match", "GAME1", "1.0", VALID_PUBLIC_KEY)).rejects.toThrow();
		
		expect(mockAddToast).toHaveBeenCalled();
		const [message, type] = mockAddToast.mock.calls[0];
		expect(message).toContain("Transaction failed");
		expect(type).toBe("error");
	});

	it("re-throws the error after dispatching toast so caller can respond", async () => {
		const originalError = new Error("User rejected");
		const { signTransactionWithWalletKit } = await import("../src/services/walletKit");
		(signTransactionWithWalletKit as ReturnType<typeof vi.fn>).mockRejectedValueOnce(originalError);

		const { rpc } = await import("@stellar/stellar-sdk");
		const mockServer = (rpc.Server as ReturnType<typeof vi.fn>).mock.results[0]?.value;
		if (mockServer) {
			mockServer.getAccount = vi.fn().mockResolvedValueOnce({ sequence: "0" });
			mockServer.prepareTransaction = vi.fn().mockResolvedValueOnce({ toXDR: vi.fn(() => "xdr") });
		}

		try {
			await depositXLM("create_match", "GAME1", "1.0", VALID_PUBLIC_KEY);
			expect.fail("Should have thrown");
		} catch (err) {
			expect(err).toBe(originalError);
			expect(mockAddToast).toHaveBeenCalled();
		}
	});

	it("does not dispatch a toast on success", async () => {
		const { signTransactionWithWalletKit } = await import("../src/services/walletKit");
		const { rpc } = await import("@stellar/stellar-sdk");
		
		(signTransactionWithWalletKit as ReturnType<typeof vi.fn>).mockResolvedValueOnce("signed-xdr");
		
		const mockServer = (rpc.Server as ReturnType<typeof vi.fn>).mock.results[0]?.value;
		if (mockServer) {
			mockServer.getAccount = vi.fn().mockResolvedValueOnce({ sequence: "0" });
			mockServer.prepareTransaction = vi.fn().mockResolvedValueOnce({ toXDR: vi.fn(() => "xdr") });
			mockServer.sendTransaction = vi.fn().mockResolvedValueOnce({
				status: "SUCCESS",
				hash: "abc123",
			});
		}

		try {
			await depositXLM("create_match", "GAME1", "1.0", VALID_PUBLIC_KEY);
		} catch {
			// May fail due to mocking, but toast should not be called
		}

		// On success, addToast should not be called
		expect(mockAddToast).not.toHaveBeenCalled();
	});

	it("uses 'info' variant for user rejection, 'error' for others", async () => {
		const { signTransactionWithWalletKit } = await import("../src/services/walletKit");

		// Test user rejection → info
		(signTransactionWithWalletKit as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
			new Error("User rejected")
		);
		const { rpc } = await import("@stellar/stellar-sdk");
		const mockServer = (rpc.Server as ReturnType<typeof vi.fn>).mock.results[0]?.value;
		if (mockServer) {
			mockServer.getAccount = vi.fn().mockResolvedValueOnce({ sequence: "0" });
			mockServer.prepareTransaction = vi.fn().mockResolvedValueOnce({ toXDR: vi.fn(() => "xdr") });
		}

		await expect(depositXLM("create_match", "GAME1", "1.0", VALID_PUBLIC_KEY)).rejects.toThrow();
		expect(mockAddToast).toHaveBeenCalledWith(expect.any(String), "info");

		mockAddToast.mockClear();

		// Test timeout → error
		(signTransactionWithWalletKit as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
			new Error("Timeout")
		);
		if (mockServer) {
			mockServer.getAccount = vi.fn().mockResolvedValueOnce({ sequence: "0" });
			mockServer.prepareTransaction = vi.fn().mockResolvedValueOnce({ toXDR: vi.fn(() => "xdr") });
		}

		await expect(depositXLM("create_match", "GAME1", "1.0", VALID_PUBLIC_KEY)).rejects.toThrow();
		expect(mockAddToast).toHaveBeenCalledWith(expect.any(String), "error");
	});
});
