import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
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
								database: { status: "healthy", database: "Neon PostgreSQL", responseTime: 80 },
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
			expect(screen.getByText("Chesster System Status")).toBeInTheDocument();
		});
		expect(screen.getByText(/return to chess lobby/i)).toBeInTheDocument();
	});

	it("renders subsystem metric cards and status banner", async () => {
		render(
			<MemoryRouter>
				<StatusPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByText(/All Systems Are Fully Operational/i)).toBeInTheDocument();
		});

		expect(screen.getByText("API Server")).toBeInTheDocument();
		expect(screen.getByText("Neon PostgreSQL")).toBeInTheDocument();
		expect(screen.getByText("Stellar / Soroban")).toBeInTheDocument();
		expect(screen.getByText("Live Moves")).toBeInTheDocument();
	});

	it("displays endpoint rows clearly", async () => {
		render(
			<MemoryRouter>
				<StatusPage />
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getByText("Backend API Server")).toBeInTheDocument();
			expect(screen.getByText("Matchmaking & Game Lobby")).toBeInTheDocument();
			expect(screen.getByText("Tournament System")).toBeInTheDocument();
			expect(screen.getByText("Leaderboard & Player Ratings")).toBeInTheDocument();
		});
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
			expect(screen.getByText(/Service Disruption Detected|Some Services Experiencing Delays/i)).toBeInTheDocument();
		});
	});
});
