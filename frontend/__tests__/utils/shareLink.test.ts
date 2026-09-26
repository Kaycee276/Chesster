import { describe, it, expect } from "vitest";
import { buildShareLink } from "../../src/utils/shareLink";

describe("buildShareLink", () => {
	it("builds a link from the origin and an upper-cased game code", () => {
		expect(buildShareLink("ab12cd", "https://chesster.example")).toBe(
			"https://chesster.example/AB12CD",
		);
	});

	it("trims whitespace around the game code", () => {
		expect(buildShareLink("  game1  ", "https://chesster.example")).toBe(
			"https://chesster.example/GAME1",
		);
	});

	it("strips trailing slashes from the origin", () => {
		expect(buildShareLink("GAME1", "https://chesster.example/")).toBe(
			"https://chesster.example/GAME1",
		);
	});

	it("throws when the game code is empty", () => {
		expect(() => buildShareLink("", "https://chesster.example")).toThrow(
			"A game code is required to build a share link",
		);
	});

	it("throws when the game code is only whitespace", () => {
		expect(() => buildShareLink("   ", "https://chesster.example")).toThrow(
			"A game code is required to build a share link",
		);
	});

	it("defaults to window.location.origin when none is passed", () => {
		expect(buildShareLink("GAME1")).toBe(`${window.location.origin}/GAME1`);
	});
});
