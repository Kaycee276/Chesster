import { describe, expect, it } from "vitest";
import {
	getGameOutcome,
	getEndReasonLabel,
	buildResultTitle,
	buildShareText,
	buildTwitterShareUrl,
} from "./gameResult";

describe("getGameOutcome", () => {
	it("returns draw when the winner is 'draw'", () => {
		expect(getGameOutcome("draw", "white")).toBe("draw");
	});

	it("returns win when the winner matches the player's color", () => {
		expect(getGameOutcome("white", "white")).toBe("win");
		expect(getGameOutcome("black", "black")).toBe("win");
	});

	it("returns loss when the winner is the opponent", () => {
		expect(getGameOutcome("black", "white")).toBe("loss");
		expect(getGameOutcome("white", "black")).toBe("loss");
	});

	it("returns loss when playerColor is unknown (spectator)", () => {
		expect(getGameOutcome("white", null)).toBe("loss");
	});
});

describe("getEndReasonLabel", () => {
	it("maps known reason codes to readable labels", () => {
		expect(getEndReasonLabel("checkmate")).toBe("Checkmate");
		expect(getEndReasonLabel("threefold_repetition")).toBe("Threefold Repetition");
		expect(getEndReasonLabel("50_move_rule")).toBe("50-Move Rule");
	});

	it("falls back to the raw code for unknown reasons", () => {
		expect(getEndReasonLabel("some_new_reason")).toBe("some_new_reason");
	});

	it("falls back to a generic label when no reason is given", () => {
		expect(getEndReasonLabel(null)).toBe("Game Over");
		expect(getEndReasonLabel(undefined)).toBe("Game Over");
	});
});

describe("buildResultTitle", () => {
	it("returns the correct headline per outcome", () => {
		expect(buildResultTitle("win")).toBe("You Win!");
		expect(buildResultTitle("loss")).toBe("You Lose");
		expect(buildResultTitle("draw")).toBe("Draw!");
	});
});

describe("buildShareText", () => {
	it("includes the game code when provided", () => {
		expect(buildShareText("win", "ABC123")).toBe(
			"I just won a chess match on @ChessterGame! (Game ABC123) Check it out!",
		);
	});

	it("omits the game code segment when not provided", () => {
		expect(buildShareText("draw")).toBe(
			"I just drew a chess match on @ChessterGame! Check it out!",
		);
	});

	it("uses 'lost' phrasing for a loss", () => {
		expect(buildShareText("loss")).toContain("I just lost a chess match");
	});
});

describe("buildTwitterShareUrl", () => {
	it("URL-encodes the share text", () => {
		const url = buildTwitterShareUrl("hello world & friends");
		expect(url).toBe(
			"https://twitter.com/intent/tweet?text=hello+world+%26+friends",
		);
	});

	it("includes the game url when provided", () => {
		const url = buildTwitterShareUrl("hi", "https://chesster.app/game/ABC");
		expect(url).toContain("url=https%3A%2F%2Fchesster.app%2Fgame%2FABC");
	});
});
