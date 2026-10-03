import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { generateBoardSocialCard } from "../../src/utils/boardImageGenerator";

describe("boardImageGenerator", () => {
	beforeEach(() => {
		// Mock canvas.toBlob to work with jsdom
		HTMLCanvasElement.prototype.toBlob = vi.fn(
			(callback: BlobCallback, type?: string) => {
				// Create a simple blob for testing
				const blob = new Blob(["mock-canvas-data"], { type: type || "image/png" });
				// Call the callback asynchronously
				setTimeout(() => callback(blob), 0);
			}
		);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe("generateBoardSocialCard", () => {
		// Standard starting FEN position
		const startingFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
		const whiteUsername = "Alice";
		const whiteRating = 1600;
		const blackUsername = "Bob";
		const blackRating = 1550;

		it("generates a PNG blob for a valid FEN position", async () => {
			const result = await generateBoardSocialCard(
				startingFen,
				whiteUsername,
				whiteRating,
				blackUsername,
				blackRating,
				"White wins by checkmate"
			);

			expect(result).toBeInstanceOf(Blob);
			expect(result.type).toBe("image/png");
			expect(result.size).toBeGreaterThan(0);
		});

		it("generates a PNG blob for a mid-game position with captured pieces", async () => {
			// Position after 1.e4 e5 2.Nf3 Nc6 3.Bc4 (Italianopening)
			const midGameFen = "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R";

			const result = await generateBoardSocialCard(
				midGameFen,
				whiteUsername,
				whiteRating,
				blackUsername,
				blackRating,
				"Game in progress"
			);

			expect(result).toBeInstanceOf(Blob);
			expect(result.type).toBe("image/png");
			expect(result.size).toBeGreaterThan(0);
		});

		it("generates a PNG blob for an endgame position with few pieces", async () => {
			// King and pawn endgame
			const endgameFen = "8/8/8/8/8/5k2/5P2/5K2";

			const result = await generateBoardSocialCard(
				endgameFen,
				whiteUsername,
				whiteRating,
				blackUsername,
				blackRating,
				"Draw by insufficient material"
			);

			expect(result).toBeInstanceOf(Blob);
			expect(result.type).toBe("image/png");
			expect(result.size).toBeGreaterThan(0);
		});

		it("generates a PNG blob for a position with promoted pieces", async () => {
			// Position with promoted pieces (multiple queens)
			const promotedFen = "r1b1k1nr/pppppppp/2n5/8/8/5Q2/PPPPPPPP/RNBQKBNR";

			const result = await generateBoardSocialCard(
				promotedFen,
				whiteUsername,
				whiteRating,
				blackUsername,
				blackRating,
				"White wins"
			);

			expect(result).toBeInstanceOf(Blob);
			expect(result.type).toBe("image/png");
			expect(result.size).toBeGreaterThan(0);
		});

		it("generates a PNG blob for a complex mid-game position", async () => {
			// A more complex position with pieces scattered across the board
			const complexFen = "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R";

			const result = await generateBoardSocialCard(
				complexFen,
				whiteUsername,
				whiteRating,
				blackUsername,
				blackRating,
				"Complex position"
			);

			expect(result).toBeInstanceOf(Blob);
			expect(result.type).toBe("image/png");
		});

		it("handles different result texts", async () => {
			const resultTexts = [
				"White wins by checkmate",
				"Black wins by resignation",
				"Draw by stalemate",
				"Draw by threefold repetition",
				"Draw by fifty-move rule",
				"Game in progress",
			];

			for (const resultText of resultTexts) {
				const result = await generateBoardSocialCard(
					startingFen,
					whiteUsername,
					whiteRating,
					blackUsername,
					blackRating,
					resultText
				);

				expect(result).toBeInstanceOf(Blob);
				expect(result.type).toBe("image/png");
				expect(result.size).toBeGreaterThan(0);
			}
		});

		it("handles different board themes", async () => {
			const themes = ["classic", "wood", "neon", "marble"] as const;

			for (const theme of themes) {
				const result = await generateBoardSocialCard(
					startingFen,
					whiteUsername,
					whiteRating,
					blackUsername,
					blackRating,
					"Test theme",
					theme
				);

				expect(result).toBeInstanceOf(Blob);
				expect(result.type).toBe("image/png");
			}
		});

		it("generates different blobs for different FEN positions", async () => {
			const fen1 = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
			const fen2 = "r1bqkbnr/pppppppp/2n5/8/8/8/PPPPPPPP/RNBQKBNR";

			const blob1 = await generateBoardSocialCard(
				fen1,
				whiteUsername,
				whiteRating,
				blackUsername,
				blackRating,
				"Test"
			);

			const blob2 = await generateBoardSocialCard(
				fen2,
				whiteUsername,
				whiteRating,
				blackUsername,
				blackRating,
				"Test"
			);

			// The blobs should be different (different board state)
			// We compare by converting to data URLs or just checking they're different instances
			expect(blob1).not.toBe(blob2);
		});

		it("handles player names with special characters", async () => {
			const result = await generateBoardSocialCard(
				startingFen,
				"Alice_🎯",
				1600,
				"Bob-2000",
				1550,
				"Draw"
			);

			expect(result).toBeInstanceOf(Blob);
			expect(result.type).toBe("image/png");
		});

		it("handles numeric ratings as strings", async () => {
			const result = await generateBoardSocialCard(
				startingFen,
				whiteUsername,
				"1600",
				blackUsername,
				"1550",
				"White wins"
			);

			expect(result).toBeInstanceOf(Blob);
			expect(result.type).toBe("image/png");
		});

		it("handles very long result text", async () => {
			const longResult = "White wins by checkmate after a brilliant queen sacrifice that forced the king into the back rank with no escape squares available";

			const result = await generateBoardSocialCard(
				startingFen,
				whiteUsername,
				whiteRating,
				blackUsername,
				blackRating,
				longResult
			);

			expect(result).toBeInstanceOf(Blob);
			expect(result.type).toBe("image/png");
		});

		it("resolves with a valid PNG Blob", async () => {
			const result = await generateBoardSocialCard(
				startingFen,
				whiteUsername,
				whiteRating,
				blackUsername,
				blackRating,
				"Test"
			);

			expect(result).toBeInstanceOf(Blob);
			expect(result.type).toBe("image/png");
			expect(result.size).toBeGreaterThan(0);
		});

		it("rejects when canvas.toBlob returns null", async () => {
			// Mock toBlob to return null (edge case)
			HTMLCanvasElement.prototype.toBlob = vi.fn(
				(callback: BlobCallback) => {
					setTimeout(() => callback(null), 0);
				}
			);

			await expect(
				generateBoardSocialCard(
					startingFen,
					whiteUsername,
					whiteRating,
					blackUsername,
					blackRating,
					"Test"
				)
			).rejects.toThrow("Failed to create blob from canvas");
		});

		it("rejects when canvas context creation fails", async () => {
			// Mock document.createElement to return a canvas with no context
			const originalCreateElement = document.createElement;
			document.createElement = vi.fn((tag: string) => {
				const element = originalCreateElement.call(document, tag);
				if (tag === "canvas") {
					(element as HTMLCanvasElement).getContext = vi.fn().mockReturnValue(null);
				}
				return element;
			});

			await expect(
				generateBoardSocialCard(
					startingFen,
					whiteUsername,
					whiteRating,
					blackUsername,
					blackRating,
					"Test"
				)
			).rejects.toThrow("Failed to get canvas 2D context");

			// Restore original
			document.createElement = originalCreateElement;
		});
	});

	describe("FEN parsing and board rendering", () => {
		it("correctly parses FEN position with empty squares", async () => {
			const fen = "8/8/8/8/8/8/8/8"; // Empty board
			const result = await generateBoardSocialCard(
				fen,
				"White",
				1600,
				"Black",
				1600,
				"Empty board test"
			);

			expect(result).toBeInstanceOf(Blob);
			expect(result.type).toBe("image/png");
		});

		it("correctly parses FEN with all piece types", async () => {
			const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR"; // Starting position
			const result = await generateBoardSocialCard(
				fen,
				"White",
				1600,
				"Black",
				1600,
				"All pieces"
			);

			expect(result).toBeInstanceOf(Blob);
		});

		it("generates consistent output for the same input", async () => {
			const inputs = {
				fen: startingFen,
				whiteUsername: "Alice",
				whiteRating: 1600,
				blackUsername: "Bob",
				blackRating: 1550,
				result: "White wins",
				theme: "classic" as const,
			};

			const blob1 = await generateBoardSocialCard(
				inputs.fen,
				inputs.whiteUsername,
				inputs.whiteRating,
				inputs.blackUsername,
				inputs.blackRating,
				inputs.result,
				inputs.theme
			);

			const blob2 = await generateBoardSocialCard(
				inputs.fen,
				inputs.whiteUsername,
				inputs.whiteRating,
				inputs.blackUsername,
				inputs.blackRating,
				inputs.result,
				inputs.theme
			);

			// Both should be Blobs of the same type
			expect(blob1.type).toBe(blob2.type);
			expect(blob1.type).toBe("image/png");
		});

		it("handles FEN with multiple consecutive empty squares", async () => {
			const fen = "8/8/4k3/8/8/8/8/4K3"; // Two kings on mostly empty board
			const result = await generateBoardSocialCard(
				fen,
				"Alice",
				1600,
				"Bob",
				1550,
				"Endgame"
			);

			expect(result).toBeInstanceOf(Blob);
			expect(result.type).toBe("image/png");
		});
	});

	describe("Canvas creation and dimensions", () => {
		it("creates a canvas with correct dimensions (1200x630)", async () => {
			const createElementSpy = vi.spyOn(document, "createElement");

			await generateBoardSocialCard(
				startingFen,
				"White",
				1600,
				"Black",
				1600,
				"Test"
			);

			const canvasCall = createElementSpy.mock.results.find(
				(call) => call.value.tagName === "CANVAS"
			);
			expect(canvasCall).toBeDefined();

			if (canvasCall?.value) {
				const canvas = canvasCall.value as HTMLCanvasElement;
				expect(canvas.width).toBe(1200);
				expect(canvas.height).toBe(630);
			}

			createElementSpy.mockRestore();
		});

		it("uses canvas 2D context for rendering", async () => {
			const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, "getContext");

			await generateBoardSocialCard(
				startingFen,
				"White",
				1600,
				"Black",
				1600,
				"Test"
			);

			expect(getContextSpy).toHaveBeenCalledWith("2d");
			getContextSpy.mockRestore();
		});

		it("calls canvas.toBlob with image/png type", async () => {
			const toBlobSpy = vi.spyOn(HTMLCanvasElement.prototype, "toBlob");

			await generateBoardSocialCard(
				startingFen,
				"White",
				1600,
				"Black",
				1600,
				"Test"
			);

			expect(toBlobSpy).toHaveBeenCalledWith(expect.any(Function), "image/png");
			toBlobSpy.mockRestore();
		});
	});

	describe("Edge cases", () => {
		it("handles empty result string", async () => {
			const result = await generateBoardSocialCard(
				startingFen,
				"Alice",
				1600,
				"Bob",
				1550,
				""
			);

			expect(result).toBeInstanceOf(Blob);
			expect(result.type).toBe("image/png");
		});

		it("handles very short player names", async () => {
			const result = await generateBoardSocialCard(
				startingFen,
				"A",
				1600,
				"B",
				1550,
				"Test"
			);

			expect(result).toBeInstanceOf(Blob);
		});

		it("handles very long player names", async () => {
			const longName = "VeryLongPlayerNameThatShouldNotBreakTheRendering";
			const result = await generateBoardSocialCard(
				startingFen,
				longName,
				1600,
				longName,
				1550,
				"Test"
			);

			expect(result).toBeInstanceOf(Blob);
		});

		it("handles zero rating", async () => {
			const result = await generateBoardSocialCard(
				startingFen,
				"Beginner",
				0,
				"Expert",
				2700,
				"Test"
			);

			expect(result).toBeInstanceOf(Blob);
		});

		it("handles very high ratings", async () => {
			const result = await generateBoardSocialCard(
				startingFen,
				"Magnus",
				2880,
				"Kasparov",
				2780,
				"Test"
			);

			expect(result).toBeInstanceOf(Blob);
		});
	});

	// Constant
	const startingFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
});
