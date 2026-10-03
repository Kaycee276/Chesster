import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import LeaderboardPage from "./LeaderboardPage";
import type { LeaderboardEntry } from "../api/leaderboardApi";
import { useWalletStore } from "../store/walletStore";

vi.mock("../api/leaderboardApi", () => ({
	getLeaderboard: vi.fn(),
}));

import { getLeaderboard } from "../api/leaderboardApi";
const getLeaderboardMock = vi.mocked(getLeaderboard);

const entry = (over: Partial<LeaderboardEntry>): LeaderboardEntry => ({
	rank: 1,
	address: "GABC1234567890",
	username: "Magnus",
	elo: 2850,
	wins: 40,
	losses: 2,
	draws: 8,
	winRate: 0.8,
	totalEarnings: 125,
	...over,
});

const entries = [
	entry({ rank: 1, address: "GA", username: "Magnus", elo: 2850 }),
	entry({ rank: 2, address: "GB", username: "Hikaru", elo: 2800 }),
	entry({ rank: 3, address: "GC", username: "Fabiano", elo: 2790 }),
	entry({ rank: 4, address: "GD", username: "Ding", elo: 2780 }),
];

afterEach(cleanup);

describe("LeaderboardPage (#316)", () => {
	beforeEach(() => {
		getLeaderboardMock.mockReset();
		useWalletStore.setState({ address: null, isConnected: false });
	});

	it("shows the top-3 podium and the full table", async () => {
		getLeaderboardMock.mockResolvedValue(entries);
		render(
			<MemoryRouter>
				<LeaderboardPage />
			</MemoryRouter>,
		);

		await screen.findAllByText("Magnus");
		expect(screen.getByLabelText("Top three players")).toBeInTheDocument();
		expect(screen.getByRole("table")).toBeInTheDocument();
	});

	it("passes the selected time-control category to the API", async () => {
		getLeaderboardMock.mockResolvedValue(entries);
		const user = userEvent.setup();
		render(
			<MemoryRouter>
				<LeaderboardPage />
			</MemoryRouter>,
		);
		await screen.findAllByText("Magnus");

		await user.click(screen.getByRole("button", { name: "Blitz" }));
		await waitFor(() =>
			expect(getLeaderboardMock).toHaveBeenLastCalledWith("blitz"),
		);

		await user.click(screen.getByRole("button", { name: "Bullet" }));
		await waitFor(() =>
			expect(getLeaderboardMock).toHaveBeenLastCalledWith("bullet"),
		);

		await user.click(screen.getByRole("button", { name: "All" }));
		await waitFor(() =>
			expect(getLeaderboardMock).toHaveBeenLastCalledWith("all"),
		);
	});

	it("shows the Your Rank footer when the connected wallet is ranked", async () => {
		useWalletStore.setState({ address: "GD", isConnected: true });
		getLeaderboardMock.mockResolvedValue(entries);
		render(
			<MemoryRouter>
				<LeaderboardPage />
			</MemoryRouter>,
		);

		expect(await screen.findByText(/your rank/i)).toBeInTheDocument();
		expect(screen.getByText("#4")).toBeInTheDocument();
	});

	it("hides the Your Rank footer when the wallet is not ranked", async () => {
		useWalletStore.setState({ address: "GZZZ", isConnected: true });
		getLeaderboardMock.mockResolvedValue(entries);
		render(
			<MemoryRouter>
				<LeaderboardPage />
			</MemoryRouter>,
		);

		await screen.findAllByText("Magnus");
		expect(screen.queryByText(/your rank/i)).not.toBeInTheDocument();
	});
});
