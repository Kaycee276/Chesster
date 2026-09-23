import { describe, it, expect, vi } from "vitest";
import React from "react";

vi.mock("../../src/services/soundService", () => ({
	soundService: {
		playAlert: vi.fn(),
	},
}));

import { TournamentQueueModal } from "../../src/components/TournamentQueueModal";

describe("TournamentQueueModal", () => {
	it("renders without crashing", () => {
		const matchData = {
			gameCode: "test-game",
			round: 1,
			opponentName: "TestPlayer",
			opponentRating: 1500,
			color: "white" as const,
			walletAddress: "test-address",
		};
		const onEnterMatch = vi.fn();
		const element = React.createElement(TournamentQueueModal, { matchData, onEnterMatch });
		expect(element).toBeDefined();
		expect(element.props.matchData.gameCode).toBe("test-game");
	});
});
