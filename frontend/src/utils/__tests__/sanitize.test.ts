import { describe, it, expect } from "vitest";
import { sanitizeChatMessage } from "../sanitize";

describe("sanitizeChatMessage", () => {
	describe("happy path", () => {
		it("leaves a plain message unchanged", () => {
			expect(sanitizeChatMessage("Nice move")).toBe("Nice move");
		});

		it("preserves emoji and normal punctuation", () => {
			expect(sanitizeChatMessage("Good game! 🔥♟️")).toBe("Good game! 🔥♟️");
		});

		it("trims surrounding whitespace", () => {
			expect(sanitizeChatMessage("  hi  ")).toBe("hi");
		});
	});

	describe("XSS exploit simulation", () => {
		it("neutralizes a script tag payload", () => {
			const result = sanitizeChatMessage("<script>alert('xss')</script>");
			expect(result).not.toContain("<script");
			expect(result).not.toContain("<");
			expect(result).not.toContain(">");
		});

		it("strips an img onerror payload entirely", () => {
			const result = sanitizeChatMessage('<img src=x onerror="alert(1)">');
			expect(result).not.toContain("onerror");
			expect(result).not.toContain("<");
		});

		it("removes a javascript: scheme link", () => {
			const result = sanitizeChatMessage('<a href="javascript:alert(1)">click</a>');
			expect(result).toBe("click");
			expect(result.toLowerCase()).not.toContain("javascript:");
		});

		it("removes a bare javascript: scheme", () => {
			expect(sanitizeChatMessage("javascript:alert(1)").toLowerCase()).not.toContain(
				"javascript:",
			);
		});

		it("strips a nested/broken tag so no angle brackets survive", () => {
			const result = sanitizeChatMessage("<<div>>hello<<//div>>");
			expect(result).not.toContain("<");
			expect(result).not.toContain(">");
		});
	});

	describe("failure modes", () => {
		it("returns an empty string for non-string input", () => {
			expect(sanitizeChatMessage(null)).toBe("");
			expect(sanitizeChatMessage(undefined)).toBe("");
			expect(sanitizeChatMessage(42)).toBe("");
			expect(sanitizeChatMessage({ evil: true })).toBe("");
		});
	});
});
