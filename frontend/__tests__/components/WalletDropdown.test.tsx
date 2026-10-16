import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const { connectWith } = vi.hoisted(() => ({ connectWith: vi.fn() }));

vi.mock("../../src/store/walletStore", () => ({
	useWalletStore: () => ({ address: null, walletType: null, connectWith, disconnect: vi.fn() }),
}));
vi.mock("../../src/store/gameStore", () => ({
	useGameStore: (selector: (state: { isStreamerMode: boolean }) => unknown) => selector({ isStreamerMode: false }),
}));
vi.mock("../../src/store/toastStore", () => ({
	useToastStore: () => ({ addToast: vi.fn() }),
}));
vi.mock("../../src/services/stellarService", () => ({ fetchAccountBalances: vi.fn() }));

import WalletDropdown from "../../src/components/WalletDropdown";

describe("WalletDropdown", () => {
	it("opens the multi-wallet kit flow from Connect Wallet", async () => {
		connectWith.mockResolvedValueOnce(undefined);
		render(<MemoryRouter><WalletDropdown /></MemoryRouter>);

		fireEvent.click(screen.getByRole("button", { name: /connect wallet/i }));

		await waitFor(() => expect(connectWith).toHaveBeenCalledWith("stellar-wallets-kit"));
	});
});
