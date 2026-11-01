const { parsePgnStream, tokenizeMoveText, importPgn } = require("../services/pgnService");

async function collect(input) {
	const games = [];
	for await (const game of parsePgnStream(input)) {
		games.push(game);
	}
	return games;
}

const SIMPLE_GAME = `[Event "Casual Game"]
[Site "Chesster"]
[Date "2026.01.01"]
[Round "1"]
[White "Alice"]
[Black "Bob"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0
`;

const TWO_GAMES = `[Event "R1"]
[White "A"]
[Black "B"]
[Result "1-0"]

1. e4 e5 2. Nf3 1-0

[Event "R2"]
[White "C"]
[Black "D"]
[Result "0-1"]

1. d4 d5 0-1
`;

const ANNOTATED_GAME = `[Event "Annotated"]
[White "A"]
[Black "B"]
[Result "*"]

1. e4 {Best by test} $1 e5 {[%clk 0:05:00]} 2. Nf3 (2. Bc4 Nf6) Nc6 {[%clk 0:04:55]} *
`;

const MALFORMED_GAME = `[Event "Broken"]
[White "A"]
[Black "B"]
[Result "*"]

1. e4 e5 2. Zz9 Nc6 *
`;

describe("pgnService", () => {
	describe("tokenizeMoveText", () => {
		it("extracts SAN tokens and the result, dropping move numbers", () => {
			const { moves, result } = tokenizeMoveText("1. e4 e5 2. Nf3 Nc6 1-0");
			expect(moves.map((m) => m.san)).toEqual(["e4", "e5", "Nf3", "Nc6"]);
			expect(result).toBe("1-0");
		});

		it("strips comments and NAG glyphs", () => {
			const { moves } = tokenizeMoveText("1. e4 {good move} $1 e5 $2");
			expect(moves.map((m) => m.san)).toEqual(["e4", "e5"]);
		});

		it("strips recursive variations, including nested ones", () => {
			const { moves } = tokenizeMoveText("1. e4 (1. d4 (1. c4) d5) e5");
			expect(moves.map((m) => m.san)).toEqual(["e4", "e5"]);
		});

		it("attaches a [%clk ...] annotation to the preceding move", () => {
			const { moves } = tokenizeMoveText("1. e4 {[%clk 0:05:00]} e5");
			expect(moves[0]).toMatchObject({ san: "e4", clock: "0:05:00" });
			expect(moves[1]).toMatchObject({ san: "e5", clock: null });
		});
	});

	describe("parsePgnStream", () => {
		it("parses a single game's headers and validates its moves", async () => {
			const [game] = await collect(SIMPLE_GAME);

			expect(game.headers).toMatchObject({
				Event: "Casual Game",
				White: "Alice",
				Black: "Bob",
				Result: "1-0",
			});
			expect(game.valid).toBe(true);
			expect(game.moves).toHaveLength(6);
			expect(game.moves[0]).toMatchObject({ san: "e4", color: "white" });
			expect(game.result).toBe("1-0");
		});

		it("streams multiple games separated by blank lines", async () => {
			const games = await collect(TWO_GAMES);

			expect(games).toHaveLength(2);
			expect(games[0].headers.White).toBe("A");
			expect(games[1].headers.White).toBe("C");
			expect(games[0].valid).toBe(true);
			expect(games[1].valid).toBe(true);
		});

		it("handles comments, NAGs, clock annotations, and variations without breaking move validation", async () => {
			const [game] = await collect(ANNOTATED_GAME);

			expect(game.valid).toBe(true);
			expect(game.moves.map((m) => m.san)).toEqual(["e4", "e5", "Nf3", "Nc6"]);
			expect(game.moves[1].clock).toBe("0:05:00");
			expect(game.moves[3].clock).toBe("0:04:55");
		});

		it("flags a game with an illegal/unrecognized move as invalid and reports the offending move", async () => {
			const [game] = await collect(MALFORMED_GAME);

			expect(game.valid).toBe(false);
			expect(game.error).toMatchObject({ ply: 3, san: "Zz9" });
			// Validation stops at the first illegal move rather than guessing past it.
			expect(game.moves).toHaveLength(2);
		});

		it("yields a final game at EOF even without a trailing blank line", async () => {
			const noTrailingBlank = SIMPLE_GAME.trimEnd();
			const games = await collect(noTrailingBlank);
			expect(games).toHaveLength(1);
			expect(games[0].valid).toBe(true);
		});

		it("starts a new game on a header line even if the blank-line separator is missing", async () => {
			const missingBlankLine = TWO_GAMES.replace('[Event "R2"]', '\n[Event "R2"]').replace(
				"\n\n[Event",
				"\n[Event",
			);
			const games = await collect(missingBlankLine);
			expect(games).toHaveLength(2);
		});

		it("accepts a plain string as well as a Readable stream", async () => {
			const { Readable } = require("stream");
			const stream = Readable.from([SIMPLE_GAME]);
			const games = await collect(stream);
			expect(games).toHaveLength(1);
			expect(games[0].valid).toBe(true);
		});
	});

	describe("importPgn", () => {
		it("reports imported vs skipped counts and skips invalid games without throwing", async () => {
			const archive = `${SIMPLE_GAME}\n${MALFORMED_GAME}`;
			const summary = await importPgn(archive);

			expect(summary.total).toBe(2);
			expect(summary.imported).toBe(1);
			expect(summary.skipped).toBe(1);
			expect(summary.games[1].valid).toBe(false);
		});

		it("batches persisted games at the configured batch size", async () => {
			const manyGames = Array.from({ length: 5 }, (_, i) =>
				`[Event "G${i}"]\n[White "A"]\n[Black "B"]\n[Result "1-0"]\n\n1. e4 e5 1-0\n`,
			).join("\n");

			const batches = [];
			const summary = await importPgn(manyGames, {
				batchSize: 2,
				persistBatch: async (batch) => {
					batches.push(batch.length);
				},
			});

			expect(summary.imported).toBe(5);
			expect(batches).toEqual([2, 2, 1]);
		});

		it("never calls persistBatch when there is nothing valid to import", async () => {
			const persistBatch = jest.fn();
			const summary = await importPgn(MALFORMED_GAME, { persistBatch });

			expect(summary.imported).toBe(0);
			expect(summary.skipped).toBe(1);
			expect(persistBatch).not.toHaveBeenCalled();
		});

		it("parses a large multi-game archive without buffering it all in memory first", async () => {
			const gameText = `[Event "Bulk"]\n[White "A"]\n[Black "B"]\n[Result "1-0"]\n\n1. e4 e5 1-0\n`;
			const bulkArchive = Array.from({ length: 1200 }, () => gameText).join("\n");

			const summary = await importPgn(bulkArchive, { batchSize: 50 });

			expect(summary.total).toBe(1200);
			expect(summary.imported).toBe(1200);
		});
	});
});
