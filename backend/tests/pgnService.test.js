const { parsePgnStream, tokenizeMoveText, importPgn, STR_TAGS, getSevenTagRoster, formatSevenTagRoster, validateSevenTagRoster, generateGamePGN, escapePgnTag, validateAndFormat } = require("../services/pgnService");

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
[Site "Chesster"]
[Date "2026.11.19"]
[Round "1"]
[White "A"]
[Black "B"]
[Result "1-0"]

1. e4 e5 2. Nf3 1-0

[Event "R2"]
[Site "Chesster"]
[Date "2026.11.19"]
[Round "1"]
[White "C"]
[Black "D"]
[Result "0-1"]

1. d4 d5 0-1
`;

const ANNOTATED_GAME = `[Event "Annotated"]
[Site "Chesster"]
[Date "2026.11.19"]
[Round "1"]
[White "A"]
[Black "B"]
[Result "*"]

1. e4 {Best by test} $1 e5 {[%clk 0:05:00]} 2. Nf3 (2. Bc4 Nf6) Nc6 {[%clk 0:04:55]} *
`;

const MALFORMED_GAME = `[Event "Broken"]
[Site "Chesster"]
[Date "2026.11.19"]
[Round "1"]
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
				`[Event "G${i}"]\n[Site "Chesster"]\n[Date "2026.11.19"]\n[Round "1"]\n[White "A"]\n[Black "B"]\n[Result "1-0"]\n\n1. e4 e5 1-0\n`,
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
			const gameText = `[Event "Bulk"]\n[Site "Chesster"]\n[Date "2026.11.19"]\n[Round "1"]\n[White "A"]\n[Black "B"]\n[Result "1-0"]\n\n1. e4 e5 1-0\n`;
			const bulkArchive = Array.from({ length: 1200 }, () => gameText).join("\n");

			const summary = await importPgn(bulkArchive, { batchSize: 50 });

			expect(summary.total).toBe(1200);
			expect(summary.imported).toBe(1200);
		});
	});
});


describe("Seven Tag Roster", () => {
  afterEach(() => jest.useRealTimers());
  const metadata = { event: "Club Championship", site: "Lagos", created_at: "2026-11-19T23:30:00-01:00", round: 0, player_white_address: "Alice", player_black_address: "Bob", result: "1-0" };
  const valid = () => formatSevenTagRoster(metadata);

  test("emits all seven tags in order using UTC calendar dates and round zero", () => {
    expect(valid()).toBe('[Event "Club Championship"]\n[Site "Lagos"]\n[Date "2026.11.20"]\n[Round "0"]\n[White "Alice"]\n[Black "Bob"]\n[Result "1-0"]');
    expect(validateSevenTagRoster(valid())).toEqual({ isValid: true, missingTags: [] });
  });

  test("supplies valid defaults for missing and invalid metadata", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-11-19T00:00:00Z"));
    const defaults = { Event: "Chesster Match", Site: "https://chesster.app", Date: "2026.11.19", Round: "-", White: "White", Black: "Black", Result: "*" };
    expect(getSevenTagRoster()).toEqual(defaults);
    expect(getSevenTagRoster({ created_at: "invalid", event: " ", site: null, white: "", black: "\n", round: "", result: "invalid" })).toEqual(defaults);
    expect(validateSevenTagRoster(formatSevenTagRoster())).toEqual({ isValid: true, missingTags: [] });
  });

  test.each(["2026.11.19", "2026-11-19", new Date("2026-11-19T12:00:00Z")])("formats date input %s consistently", (date) => {
    expect(getSevenTagRoster({ date, white: "W", black: "B" })).toMatchObject({ Date: "2026.11.19", White: "W", Black: "B" });
  });
  test.each([new Date("+010000-01-01T00:00:00Z"), new Date("-000001-01-01T00:00:00Z")])("replaces dates outside the four digit PGN year range", (date) => {
    jest.useFakeTimers().setSystemTime(new Date("2026-11-19T00:00:00Z"));
    expect(getSevenTagRoster({ date }).Date).toBe("2026.11.19");
    expect(validateSevenTagRoster(formatSevenTagRoster({ date })).isValid).toBe(true);
  });
  test("supports legacy createdAt metadata and match start dates", () => {
    expect(getSevenTagRoster({ createdAt: "2026-01-02T00:00:00Z" }).Date).toBe("2026.01.02");
    expect(getSevenTagRoster({ game_started_at: "2026-01-03T00:00:00Z", created_at: "2026-01-01T00:00:00Z" }).Date).toBe("2026.01.03");
  });
  test.each(["1-0", "0-1", "1/2-1/2", "*"])("accepts the standard result %s", (result) => {
    expect(getSevenTagRoster({ result }).Result).toBe(result);
    expect(validateSevenTagRoster(formatSevenTagRoster({ result })).isValid).toBe(true);
  });
  test.each([
    [{ winner: "white", end_reason: "resignation" }, "1-0"],
    [{ winner: "black", end_reason: "timeout" }, "0-1"],
    [{ winner: "draw" }, "1/2-1/2"],
    [{ is_draw: true }, "1/2-1/2"],
    [{ winner: "Alice", player_white_address: "Alice" }, "1-0"],
    [{ winner: "Bob", player_black_address: "Bob" }, "0-1"],
    [{ winner: "unknown" }, "*"],
    [{ result: "invalid" }, "*"],
  ])("derives a valid result from %j", (game, result) => {
    expect(getSevenTagRoster(game).Result).toBe(result);
  });

  test.each(STR_TAGS)("reports a missing %s tag", (tag) => {
    const incomplete = valid().split("\n").filter((line) => !line.startsWith(`[${tag} `)).join("\n");
    expect(validateSevenTagRoster(incomplete)).toEqual({ isValid: false, missingTags: [tag] });
  });
  test.each([undefined, null, 42, "", "1. e4 *"])("rejects absent headers in %j", (pgn) => {
    expect(validateSevenTagRoster(pgn)).toEqual({ isValid: false, missingTags: STR_TAGS });
  });
  test("rejects reordered, duplicated and interrupted rosters", () => {
    const lines = valid().split("\n");
    [lines[0], lines[1]] = [lines[1], lines[0]];
    expect(validateSevenTagRoster(lines.join("\n"))).toEqual({ isValid: false, missingTags: [] });
    expect(validateSevenTagRoster(`${valid()}\n[Result "1-0"]`).isValid).toBe(false);
    expect(validateSevenTagRoster(`[Annotator "Engine"]\n${valid()}`).isValid).toBe(false);
    expect(validateSevenTagRoster(valid().replace('[Round "0"]', '[Annotator "Engine"]\n[Round "0"]')).isValid).toBe(false);
  });
  test.each(["2026-11-19", "2026.2.03", "2026.02.29", "2026.04.31", "2026.00.10", "2026.13.01", "????.??.??"])("rejects the malformed calendar date %s", (date) => {
    expect(validateSevenTagRoster(valid().replace("2026.11.20", date)).isValid).toBe(false);
  });
  test("accepts leap days and optional tags after the roster with CRLF", () => {
    const pgn = formatSevenTagRoster({ date: "2024.02.29" }) + '\n[Annotator "Engine"]\n\n1. e4 *';
    expect(validateSevenTagRoster(pgn.replaceAll("\n", "\r\n")).isValid).toBe(true);
  });
  test.each(["win", "draw", "1/2", "2-0", ""])("rejects the invalid result %s", (result) => {
    expect(validateSevenTagRoster(valid().replace('[Result "1-0"]', `[Result "${result}"]`)).isValid).toBe(false);
  });
  test("rejects empty identities, malformed quoting and header injection", () => {
    expect(validateSevenTagRoster(valid().replace('[White "Alice"]', '[White " "]')).isValid).toBe(false);
    expect(validateSevenTagRoster(valid().replace('[Event "Club Championship"]', '[Event "Unescaped "quote""]')).isValid).toBe(false);
    const stopped = valid().replace('[Result "1-0"]', '1. e4 *\n[Result "1-0"]');
    expect(validateSevenTagRoster(stopped).missingTags).toEqual(["Result"]);
  });
  test("escapes quotes, backslashes and control characters and decodes them on import", async () => {
    const event = 'Alice "Ace" \\ Bob';
    const pgn = formatSevenTagRoster({ event, white: 'A\n[Result "0-1"]', black: "B" });
    expect(escapePgnTag('line\r\n\tend')).toBe("line   end");
    expect(validateSevenTagRoster(pgn).isValid).toBe(true);
    const [game] = await collect(`${pgn}\n\n1. e4 *`);
    expect(game.headers.Event).toBe(event);
    expect(game.headers.White).toBe('A [Result "0-1"]');
    expect(game.valid).toBe(true);
  });

  test("single game and rich tournament exports use the same roster and terminal result", () => {
    const chessEngine = require("../services/chessEngine");
    for (const game of [{ winner: "white", end_reason: "resignation" }, { winner: "black", end_reason: "time" }, { winner: "draw" }, { result: "invalid" }]) {
      const exported = generateGamePGN({ ...metadata, result: undefined, ...game });
      expect(validateSevenTagRoster(exported).isValid).toBe(true);
      expect(exported.trim().split("\n").at(-1)).toBe(getSevenTagRoster(game).Result);
      const rich = chessEngine.generateRichPgn([], { date: new Date("2026-11-19T00:00:00Z"), result: game.result });
      expect(validateSevenTagRoster(rich).isValid).toBe(true);
    }
  });
  test("keeps import validation available for raw game records", () => {
    expect(validateAndFormat({ headers: getSevenTagRoster(metadata), movesStr: "1. e4 1-0" }).valid).toBe(true);
  });
  test("skips incomplete, out of order or malformed headers and inconsistent results before persistence", async () => {
    const persistBatch = jest.fn();
    const cases = [
      SIMPLE_GAME.replace('[Site "Chesster"]\n', ""),
      SIMPLE_GAME.replace('[Round "1"]', '[Round "1"]\n[Event "Duplicate"]'),
      SIMPLE_GAME.replace('2026.01.01', '2026.02.30'),
      SIMPLE_GAME.replace('1-0\n', '0-1\n'),
    ];
    for (const pgn of cases) {
      const summary = await importPgn(pgn, { persistBatch });
      expect(summary).toMatchObject({ imported: 0, skipped: 1 });
      expect(summary.games[0].error.message).toMatch(/Roster|result/);
    }
    expect(persistBatch).not.toHaveBeenCalled();
  });
});
