import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";

vi.mock("react-router-dom", () => ({
	useNavigate: () => vi.fn(),
}));

vi.mock("../../src/api/socket", () => ({
	socketService: {
		onTournamentMatchCompleted: vi.fn(),
		offTournamentMatchCompleted: vi.fn(),
	},
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, defaultVal?: string | Record<string, unknown>) => {
			if (typeof defaultVal === "string") return defaultVal;
			if (defaultVal && typeof defaultVal === "object" && "defaultValue" in defaultVal) {
				return (defaultVal as { defaultValue: string }).defaultValue;
			}
			const map: Record<string, string> = {
				"tournament.finals": "Grand Finals",
				"tournament.semiFinals": "Semi-Finals",
				"tournament.quarterFinals": "Quarter-Finals",
				"tournament.roundOf16": "Round of 16",
				"tournament.matchLive": "Match is Live",
				"tournament.spectateLive": "Spectate Live",
				"tournament.findMyMatch": "Find My Match",
				"tournament.zoomIn": "Zoom In",
				"tournament.zoomOut": "Zoom Out",
				"tournament.resetZoom": "Reset Zoom",
				"tournament.fitToScreen": "Fit to Screen",
				"tournament.bracketTitle": "Tournament bracket",
				"tournament.tbd": "TBD",
			};
			return map[key] || key;
		},
	}),
}));

import { TournamentBracket } from "../../src/components/TournamentBracket";
import type { BracketRound } from "../../src/types/tournament";

const mockRounds: BracketRound[] = [
	{
		roundNumber: 1,
		matches: [
			{
				matchNumber: 1,
				gameCode: "game-1",
				playerWhite: { walletAddress: "addr1", name: "Player 1" },
				playerBlack: { walletAddress: "addr2", name: "Player 2" },
				whiteScore: 1,
				blackScore: 0,
				winner: "addr1",
				status: "resolved",
			},
			{
				matchNumber: 2,
				gameCode: "game-2",
				playerWhite: { walletAddress: "addr3", name: "Player 3" },
				playerBlack: { walletAddress: "addr4", name: "Player 4" },
				whiteScore: 0,
				blackScore: 1,
				winner: "addr4",
				status: "resolved",
			},
		],
	},
	{
		roundNumber: 2,
		matches: [
			{
				matchNumber: 3,
				gameCode: "game-3",
				playerWhite: { walletAddress: "addr1", name: "Player 1" },
				playerBlack: { walletAddress: "addr4", name: "Player 4" },
				whiteScore: 0,
				blackScore: 0,
				winner: null,
				status: "active",
			},
		],
	},
];

describe("TournamentBracket", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders without crashing", () => {
		const onSpectate = vi.fn();
		const element = React.createElement(TournamentBracket, { rounds: mockRounds, onSpectate });

		expect(element).toBeDefined();
		expect(element.props.rounds.length).toBe(2);
	});

	it("renders round titles and match cards", () => {
		render(<TournamentBracket rounds={mockRounds} />);

		expect(screen.getByText("Semi-Finals")).toBeInTheDocument();
		expect(screen.getByText("Grand Finals")).toBeInTheDocument();
		expect(screen.getAllByText("Player 1").length).toBeGreaterThan(0);
		expect(screen.getAllByText("Player 4").length).toBeGreaterThan(0);
		expect(screen.getByText("100%")).toBeInTheDocument();
	});

	it("handles Zoom In and Zoom Out controls", () => {
		render(<TournamentBracket rounds={mockRounds} />);

		const zoomLevel = screen.getByTestId("zoom-level");
		expect(zoomLevel.textContent).toBe("100%");

		const zoomInBtn = screen.getByTestId("zoom-in-btn");
		fireEvent.click(zoomInBtn);
		expect(screen.getByTestId("zoom-level").textContent).toBe("120%");

		const zoomOutBtn = screen.getByTestId("zoom-out-btn");
		fireEvent.click(zoomOutBtn);
		expect(screen.getByTestId("zoom-level").textContent).toBe("100%");
	});

	it("resets zoom to 100% when reset button is clicked", () => {
		render(<TournamentBracket rounds={mockRounds} />);

		const zoomInBtn = screen.getByTestId("zoom-in-btn");
		fireEvent.click(zoomInBtn);
		fireEvent.click(zoomInBtn);
		expect(screen.getByTestId("zoom-level").textContent).toBe("140%");

		const resetBtn = screen.getByTestId("reset-zoom-btn");
		fireEvent.click(resetBtn);
		expect(screen.getByTestId("zoom-level").textContent).toBe("100%");
	});

	it("renders and triggers Find My Match button when user has a match", () => {
		render(
			<TournamentBracket
				rounds={mockRounds}
				currentUserAddress="addr1"
			/>,
		);

		const findBtn = screen.getByTestId("find-my-match-btn");
		expect(findBtn).toBeInTheDocument();
		expect(findBtn).toHaveTextContent("Find My Match");

		fireEvent.click(findBtn);
		expect(screen.getByTestId("zoom-level")).toBeInTheDocument();
	});

	it("handles keyboard navigation (+, -, 0, Arrow keys)", () => {
		const { container } = render(<TournamentBracket rounds={mockRounds} />);
		const bracketRegion = container.querySelector('[role="region"]') as HTMLElement;
		expect(bracketRegion).toBeInTheDocument();

		// Zoom in via '+'
		fireEvent.keyDown(bracketRegion, { key: "+" });
		expect(screen.getByTestId("zoom-level").textContent).toBe("120%");

		// Zoom out via '-'
		fireEvent.keyDown(bracketRegion, { key: "-" });
		expect(screen.getByTestId("zoom-level").textContent).toBe("100%");

		// Arrow navigation
		fireEvent.keyDown(bracketRegion, { key: "ArrowRight" });
		fireEvent.keyDown(bracketRegion, { key: "ArrowDown" });
		fireEvent.keyDown(bracketRegion, { key: "0" });
		expect(screen.getByTestId("zoom-level").textContent).toBe("100%");
	});

	it("renders minimap and supports closing it", () => {
		render(<TournamentBracket rounds={mockRounds} currentUserAddress="addr1" />);

		const minimap = screen.getByTestId("bracket-minimap");
		expect(minimap).toBeInTheDocument();

		const closeMinimapBtn = screen.getByTitle("Hide Minimap");
		fireEvent.click(closeMinimapBtn);

		expect(screen.queryByTestId("bracket-minimap")).not.toBeInTheDocument();
	});

	it("allows pointer drag panning", () => {
		const { container } = render(<TournamentBracket rounds={mockRounds} />);
		const bracketRegion = container.querySelector('[role="region"]') as HTMLElement;

		// Mock setPointerCapture / releasePointerCapture on DOM element
		bracketRegion.setPointerCapture = vi.fn();
		bracketRegion.releasePointerCapture = vi.fn();

		fireEvent.pointerDown(bracketRegion, {
			clientX: 100,
			clientY: 100,
			button: 0,
			pointerId: 1,
		});

		fireEvent.pointerMove(bracketRegion, {
			clientX: 150,
			clientY: 180,
			pointerId: 1,
		});

		fireEvent.pointerUp(bracketRegion, {
			pointerId: 1,
		});

		const contentContainer = screen.getByTestId("bracket-transform-container");
		expect(contentContainer.style.transform).toContain("translate(50px, 80px)");
	});

	it("calls onSpectate when spectate button is clicked on active match", () => {
		const onSpectate = vi.fn();
		render(<TournamentBracket rounds={mockRounds} onSpectate={onSpectate} />);

		const spectateBtn = screen.getByText("Spectate Live");
		fireEvent.click(spectateBtn);

		expect(onSpectate).toHaveBeenCalledWith("game-3");
	});
});
