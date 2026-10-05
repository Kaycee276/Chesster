import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import StatusPage from "./StatusPage";

// Mock socket
vi.mock("../api/socket", () => ({
	getSocket: vi.fn(() => ({
		connected: true,
		on: vi.fn(),
		off: vi.fn(),
	})),
}));

afterEach(cleanup);

describe("StatusPage", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		global.fetch = vi.fn().mockImplementation((url: string) => {
			if (url.includes("/api/status")) {
				return Promise.resolve({
					ok: true,
					status: 200,
					statusText: "OK",
					json: () =>
						Promise.resolve({
							status: "healthy",
							uptime: 3600,
							environment: "production",
							services: {
								database: { status: "healthy", database: "Postgres", responseTime: 80 },
								stellarRpc: { status: "healthy", network: "testnet", latestLedger: 5000000, responseTime: 120 },
							},
						}),
				});
			}
			return Promise.resolve({
				ok: true,
				status: 200,
				statusText: "OK",
				json: () => Promise.resolve({ status: "ok" }),
			});
		});
	});

	it("renders the page title and top-level navigation", async () => {
		render(
			<MemoryRouter>
				<StatusPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByText("Chesster Status")).toBeInTheDocument();
		});
		expect(screen.getByText(/back to match lobby/i)).toBeInTheDocument();
	});

	it("renders subsystem metric cards and status banner", async () => {
		render(
			<MemoryRouter>
				<StatusPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByText(/All Systems Operational/i)).toBeInTheDocument();
		});

		expect(screen.getByText(/Backend Web Server/i)).toBeInTheDocument();
		expect(screen.getByText(/Database \(PostgreSQL\)/i)).toBeInTheDocument();
		expect(screen.getAllByText(/Stellar & Soroban RPC/i).length).toBeGreaterThanOrEqual(1);
		expect(screen.getByText(/Realtime WebSockets/i)).toBeInTheDocument();
	});

	it("displays endpoint rows and allows filtering by category", async () => {
		const user = userEvent.setup();
		render(
			<MemoryRouter>
				<StatusPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByText("Server Liveness Probe")).toBeInTheDocument();
			expect(screen.getByText("Tournament Engine")).toBeInTheDocument();
			expect(screen.getByText("Leaderboard & Elo Rankings")).toBeInTheDocument();
		});

		// Click "Gameplay & Lobby" category tab
		const gameplayTab = screen.getByRole("button", { name: "Gameplay & Lobby" });
		await user.click(gameplayTab);

		expect(screen.getByText("Tournament Engine")).toBeInTheDocument();
		expect(screen.queryByText("Server Liveness Probe")).not.toBeInTheDocument();
	});

	it("handles degraded and failed endpoints gracefully", async () => {
		global.fetch = vi.fn().mockImplementation((url: string) => {
			if (url.includes("/health")) {
				return Promise.resolve({
					ok: false,
					status: 503,
					statusText: "Service Unavailable",
					json: () => Promise.reject(new Error("Down")),
				});
			}
			return Promise.resolve({
				ok: true,
				status: 200,
				statusText: "OK",
				json: () => Promise.resolve({ status: "ok" }),
			});
		});

		render(
			<MemoryRouter>
				<StatusPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByText(/Critical Service Outage|Degraded Performance Detected/i)).toBeInTheDocument();
		});
	});
});
