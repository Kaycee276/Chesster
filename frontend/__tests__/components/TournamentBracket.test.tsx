import { describe, it, expect, vi } from "vitest";
import React from "react";

vi.mock("react-router-dom", () => ({
	useNavigate: () => vi.fn(),
}));

vi.mock("../../src/api/socket", () => ({
	socketService: {
		onTournamentMatchCompleted: vi.fn(),
		offTournamentMatchCompleted: vi.fn(),
	},
}));

import { TournamentBracket } from "../../src/components/TournamentBracket";
import { BracketRound } from "../../src/types/tournament";

describe("TournamentBracket", () => {
	it("renders without crashing", () => {
		const rounds: BracketRound[] = [
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

		const onSpectate = vi.fn();
		const element = React.createElement(TournamentBracket, { rounds, onSpectate });
		
		expect(element).toBeDefined();
		expect(element.props.rounds.length).toBe(2);
	});
});
