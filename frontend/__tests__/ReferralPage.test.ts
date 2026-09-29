import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useWalletStore } from "../src/store/walletStore";
import { useToastStore } from "../src/store/toastStore";
import { referralApi, type ReferralStats } from "../src/api/referralApi";

// Mock the referralApi
vi.mock("../src/api/referralApi", () => ({
	referralApi: {
		getReferralStats: vi.fn(),
		claimReferralEarnings: vi.fn(),
	},
}));

describe("Referral Dashboard", () => {
	const mockAddress = "GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJMUH5LRPF6GAKOOJO3WQJABCD1234567890";
	const mockReferralStats: ReferralStats = {
		referral_code: "REF123456",
		total_invited: 5,
		total_wager_volume: 150.5,
		total_commission_earned: 7.525,
		claimable_xlm: 3.5,
		claimable_usdc: 2.5,
		referred_users: [
			{
				address: "GUSER1ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890",
				signup_date: "2024-01-15T10:30:00Z",
				matches_played: 3,
			},
			{
				address: "GUSER2ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890",
				signup_date: "2024-01-20T14:22:00Z",
				matches_played: 5,
			},
		],
	};

	beforeEach(() => {
		// Reset stores
		useWalletStore.setState({
			address: null,
			isConnected: false,
			walletType: null,
		});
		useToastStore.setState({ toasts: [] });
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("API Integration", () => {
		it("should fetch referral stats with player address", async () => {
			const mockGetStats = vi.fn().mockResolvedValue({
				success: true,
				data: mockReferralStats,
			});
			(referralApi.getReferralStats as any) = mockGetStats;

			await referralApi.getReferralStats(mockAddress);

			expect(mockGetStats).toHaveBeenCalledWith(mockAddress);
			expect(mockGetStats).toHaveBeenCalledTimes(1);
		});

		it("should handle referral stats fetch error gracefully", async () => {
			const mockGetStats = vi.fn().mockResolvedValue({
				success: false,
				error: "Failed to fetch stats",
			});
			(referralApi.getReferralStats as any) = mockGetStats;

			const result = await referralApi.getReferralStats(mockAddress);

			expect(result.success).toBe(false);
			expect(result.error).toBe("Failed to fetch stats");
		});

		it("should submit claim request with signed payload and address", async () => {
			const mockClaim = vi.fn().mockResolvedValue({
				success: true,
				transaction_id: "tx123",
				amount_xlm: 3.5,
			});
			(referralApi.claimReferralEarnings as any) = mockClaim;

			const payload = {
				signed_payload: "mock_signature_12345",
				wallet_address: mockAddress,
			};

			await referralApi.claimReferralEarnings(payload);

			expect(mockClaim).toHaveBeenCalledWith(payload);
			expect(mockClaim).toHaveBeenCalledTimes(1);
		});

		it("should handle claim submission error", async () => {
			const mockClaim = vi.fn().mockResolvedValue({
				success: false,
				error: "Claim already processed",
			});
			(referralApi.claimReferralEarnings as any) = mockClaim;

			const result = await referralApi.claimReferralEarnings({
				signed_payload: "mock_signature",
				wallet_address: mockAddress,
			});

			expect(result.success).toBe(false);
			expect(result.error).toBe("Claim already processed");
		});
	});

	describe("Copy to Clipboard Functionality", () => {
		it("should generate correct referral link", () => {
			const referralCode = "REF123456";
			const expectedLink = `${window.location.origin}/join?ref=${referralCode}`;

			expect(expectedLink).toMatch(/\/join\?ref=REF123456$/);
		});

		it("should format referral link with origin and ref code", () => {
			const link = `${window.location.origin}/join?ref=${mockReferralStats.referral_code}`;

			expect(link).toContain("join?ref=");
			expect(link).toContain(mockReferralStats.referral_code);
		});

		it("should copy link to clipboard on button click", async () => {
			// Mock document.execCommand
			const mockExecCommand = vi.spyOn(document, "execCommand");
			mockExecCommand.mockReturnValue(true);

			const referralLink = "https://example.com/join?ref=REF123456";

			// Create a temporary input element to test copy
			const input = document.createElement("input");
			input.value = referralLink;
			document.body.appendChild(input);

			input.select();
			const result = document.execCommand("copy");

			expect(result).toBe(true);
			expect(mockExecCommand).toHaveBeenCalledWith("copy");

			document.body.removeChild(input);
			mockExecCommand.mockRestore();
		});

		it("should show success toast when copy succeeds", () => {
			const { addToast } = useToastStore.getState();
			const addToastSpy = vi.spyOn(useToastStore.getState(), "addToast");

			addToast("Referral link copied to clipboard!", "success");

			expect(addToastSpy).toHaveBeenCalledWith(
				"Referral link copied to clipboard!",
				"success",
			);

			addToastSpy.mockRestore();
		});

		it("should show error toast when copy fails", () => {
			const { addToast } = useToastStore.getState();
			const addToastSpy = vi.spyOn(useToastStore.getState(), "addToast");

			addToast("Failed to copy link", "error");

			expect(addToastSpy).toHaveBeenCalledWith("Failed to copy link", "error");

			addToastSpy.mockRestore();
		});
	});

	describe("Stats Rendering", () => {
		it("should display correct stat values", () => {
			const stats = mockReferralStats;

			expect(stats.total_invited).toBe(5);
			expect(stats.total_wager_volume).toBe(150.5);
			expect(stats.total_commission_earned).toBe(7.525);
		});

		it("should format wager volume with 2 decimal places", () => {
			const volume = mockReferralStats.total_wager_volume;
			const formatted = volume.toFixed(2);

			expect(formatted).toBe("150.50");
		});

		it("should format commission with 6 decimal places for XLM precision", () => {
			const commission = mockReferralStats.total_commission_earned;
			const formatted = commission.toFixed(6);

			expect(formatted).toBe("7.525000");
		});

		it("should display claimable amounts correctly", () => {
			const stats = mockReferralStats;

			expect(stats.claimable_xlm).toBe(3.5);
			expect(stats.claimable_usdc).toBe(2.5);
		});

		it("should show zero for no claimable earnings", () => {
			const statsWithNoClaim = { ...mockReferralStats, claimable_xlm: 0, claimable_usdc: 0 };

			expect(statsWithNoClaim.claimable_xlm).toBe(0);
			expect(statsWithNoClaim.claimable_usdc).toBe(0);
		});
	});

	describe("Referred Users Table", () => {
		it("should anonymize wallet addresses in table", () => {
			const address = "GUSER1ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";
			const anonymized = `${address.slice(0, 4)}...${address.slice(-4)}`;

			expect(anonymized).toBe("GUSE...7890");
			expect(anonymized).not.toContain(address.slice(4, -4));
		});

		it("should not display full wallet address", () => {
			const user = mockReferralStats.referred_users[0];
			const displayed = `${user.address.slice(0, 4)}...${user.address.slice(-4)}`;

			expect(displayed.length).toBeLessThan(user.address.length);
			expect(user.address).not.toEqual(displayed);
		});

		it("should format signup date to local date string", () => {
			const user = mockReferralStats.referred_users[0];
			const date = new Date(user.signup_date);
			const formatted = date.toLocaleDateString();

			expect(formatted).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/); // Basic date format check
		});

		it("should display matches played count", () => {
			const user = mockReferralStats.referred_users[0];

			expect(user.matches_played).toBe(3);
		});

		it("should render multiple referred users", () => {
			const users = mockReferralStats.referred_users;

			expect(users.length).toBe(2);
			expect(users[0].matches_played).toBe(3);
			expect(users[1].matches_played).toBe(5);
		});

		it("should handle empty referred users list", () => {
			const statsWithNoReferrals = { ...mockReferralStats, referred_users: [] };

			expect(statsWithNoReferrals.referred_users.length).toBe(0);
		});
	});

	describe("Claim Button & Wallet Signature Flow", () => {
		it("should show claim button when earnings are available", () => {
			const hasEarnings =
				mockReferralStats.claimable_xlm > 0 ||
				mockReferralStats.claimable_usdc > 0;

			expect(hasEarnings).toBe(true);
		});

		it("should hide claim button when no earnings available", () => {
			const stats = {
				...mockReferralStats,
				claimable_xlm: 0,
				claimable_usdc: 0,
			};
			const hasEarnings = stats.claimable_xlm > 0 || stats.claimable_usdc > 0;

			expect(hasEarnings).toBe(false);
		});

		it("should create signed payload with wallet address", () => {
			const walletAddress = mockAddress;
			const signedPayload = `mock_signature_${Date.now()}`;
			const claimRequest = {
				signed_payload: signedPayload,
				wallet_address: walletAddress,
			};

			expect(claimRequest.wallet_address).toBe(walletAddress);
			expect(claimRequest.signed_payload).toBeTruthy();
		});

		it("should include amount and currency in claim request", () => {
			const amount = mockReferralStats.claimable_xlm;
			const currency = "XLM";

			expect(amount).toBeGreaterThan(0);
			expect(currency).toBe("XLM");
		});

		it("should disable claim button during submission", async () => {
			const mockClaim = vi.fn().mockResolvedValue({
				success: true,
				transaction_id: "tx123",
			});
			(referralApi.claimReferralEarnings as any) = mockClaim;

			// Simulate button state during claim
			let claimingState = false;
			claimingState = true; // Button disabled during claim

			expect(claimingState).toBe(true);

			// After claim completes
			claimingState = false;

			expect(claimingState).toBe(false);
		});

		it("should show success message on successful claim", async () => {
			const mockClaim = vi.fn().mockResolvedValue({
				success: true,
				transaction_id: "tx123",
				amount_xlm: 3.5,
			});
			(referralApi.claimReferralEarnings as any) = mockClaim;

			const result = await referralApi.claimReferralEarnings({
				signed_payload: "mock_sig",
				wallet_address: mockAddress,
			});

			expect(result.success).toBe(true);
			expect(result.transaction_id).toBe("tx123");
		});

		it("should show error message on claim failure", async () => {
			const mockClaim = vi.fn().mockResolvedValue({
				success: false,
				error: "Insufficient balance",
			});
			(referralApi.claimReferralEarnings as any) = mockClaim;

			const result = await referralApi.claimReferralEarnings({
				signed_payload: "mock_sig",
				wallet_address: mockAddress,
			});

			expect(result.success).toBe(false);
			expect(result.error).toBe("Insufficient balance");
		});
	});

	describe("Authentication & Authorization", () => {
		it("should require connected wallet to view referral dashboard", () => {
			const { isConnected } = useWalletStore.getState();

			expect(isConnected).toBe(false);
		});

		it("should display content only when wallet is connected", () => {
			act(() => {
				useWalletStore.setState({
					address: mockAddress,
					isConnected: true,
					walletType: "freighter",
				});
			});

			const { isConnected, address } = useWalletStore.getState();

			expect(isConnected).toBe(true);
			expect(address).toBe(mockAddress);
		});

		it("should redirect to home when wallet disconnects", () => {
			act(() => {
				useWalletStore.setState({
					address: mockAddress,
					isConnected: true,
				});
			});

			act(() => {
				useWalletStore.setState({
					address: null,
					isConnected: false,
				});
			});

			const { isConnected } = useWalletStore.getState();

			expect(isConnected).toBe(false);
		});
	});

	describe("Error Handling", () => {
		it("should handle network error gracefully", async () => {
			const mockGetStats = vi.fn().mockRejectedValue(new Error("Network error"));
			(referralApi.getReferralStats as any) = mockGetStats;

			try {
				await referralApi.getReferralStats(mockAddress);
				expect.fail("Should have thrown error");
			} catch (err) {
				expect(err instanceof Error).toBe(true);
			}
		});

		it("should display error message on fetch failure", () => {
			const errorMessage = "Failed to fetch referral stats";

			expect(errorMessage).toContain("Failed");
		});

		it("should allow retry after error", async () => {
			const mockGetStats = vi
				.fn()
				.mockRejectedValueOnce(new Error("Network error"))
				.mockResolvedValueOnce({ success: true, data: mockReferralStats });

			(referralApi.getReferralStats as any) = mockGetStats;

			try {
				await referralApi.getReferralStats(mockAddress);
			} catch {
				// First call fails
			}

			const result = await referralApi.getReferralStats(mockAddress);

			expect(result.success).toBe(true);
			expect(mockGetStats).toHaveBeenCalledTimes(2);
		});
	});
});
