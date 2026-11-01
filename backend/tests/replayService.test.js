const chessEngine = require("../services/chessEngine");
const replayService = require("../services/replayService");

const T0 = Date.parse("2026-03-01T12:00:00.000Z");
const at = (seconds) => new Date(T0 + seconds * 1000).toISOString();

/** Play `moves` from the initial position, returning moves-table rows. */
function playMoves(moves) {
	let board = chessEngine.initBoard();
	return moves.map(([from, to, seconds, extra = {}], i) => {
		const piece = board[from[0]][from[1]];
		board = chessEngine.makeMove(board, from, to, null, Boolean(extra.enPassant));
		return {
			move_number: i + 1,
			player: i % 2 === 0 ? "white" : "black",
			from_position: from,
			to_position: to,
			piece,
			promotion: null,
			is_check: false,
			is_checkmate: false,
			board_state_after: board,
			created_at: at(seconds),
		};
	});
}

describe("replayService", () => {
	describe("generateTournamentPgnArchive", () => {
		it("exports completed games in round and board order with standard PGN tags", async () => {
			const rows = {
				bracket_matches: [
					{ game_code: "G2", round: 2, match_number: 1, status: "completed" },
					{ game_code: "G1", round: 1, match_number: 2, status: "completed" },
				],
				games: {
					G1: { id: "game-1", game_code: "G1", status: "finished", winner: "white", player_white_address: "GWHITE", player_black_address: "GBLACK" },
					G2: { id: "game-2", game_code: "G2", status: "finished", winner: "draw" },
				},
				moves: { "game-1": [], "game-2": [] },
			};
			const db = {
				from(table) {
					let filters = {};
					const builder = {
						select() { return this; },
						eq(key, value) { filters[key] = value; return this; },
						order() { return this; },
						maybeSingle() { return Promise.resolve({ data: rows[table][filters.game_code], error: null }); },
						then(resolve, reject) {
							const data = table === "bracket_matches" ? rows[table] : rows[table][filters.game_id];
							return Promise.resolve({ data, error: null }).then(resolve, reject);
						},
					};
					return builder;
				},
			};

			const archive = await replayService.generateTournamentPgnArchive("tournament-1", db);

			expect(archive.match(/\[Event "Tournament #tournament-1"\]/g)).toHaveLength(2);
			expect(archive.indexOf('[Round "1.2"]')).toBeLessThan(archive.indexOf('[Round "2.1"]'));
			expect(archive).toContain('[White "GWHITE"]');
			expect(archive).toContain('[Result "1-0"]');
			expect(archive).toContain('[Result "1/2-1/2"]');
		});
	});

	describe("parseSpeed", () => {
		it("defaults to 1x", () => {
			expect(replayService.parseSpeed(undefined)).toBe(1);
			expect(replayService.parseSpeed("")).toBe(1);
		});

		it("accepts common multipliers, with or without an x suffix", () => {
			expect(replayService.parseSpeed("2")).toBe(2);
			expect(replayService.parseSpeed("5x")).toBe(5);
			expect(replayService.parseSpeed("1.5")).toBe(1.5);
		});

		it("clamps out-of-range speeds", () => {
			expect(replayService.parseSpeed("0.1")).toBe(1);
			expect(replayService.parseSpeed("-3")).toBe(1);
			expect(replayService.parseSpeed("500")).toBe(replayService.MAX_SPEED);
		});

		it("rejects non-numeric speeds", () => {
			expect(replayService.parseSpeed("fast")).toBeNull();
		});
	});

	describe("replayDelayMs", () => {
		it("divides the original move duration by the speed multiplier", () => {
			expect(replayService.replayDelayMs(4000, 1)).toBe(4000);
			expect(replayService.replayDelayMs(4000, 2)).toBe(2000);
			expect(replayService.replayDelayMs(4000, 5)).toBe(800);
		});

		it("caps very long thinks and ignores bad durations", () => {
			expect(replayService.replayDelayMs(10 * 60 * 1000, 1)).toBe(replayService.MAX_MOVE_DELAY_MS);
			expect(replayService.replayDelayMs(-50, 1)).toBe(0);
			expect(replayService.replayDelayMs(undefined, 2)).toBe(0);
		});
	});

	describe("buildReplayFrames", () => {
		const game = { time_control_seconds: 300, time_increment_seconds: 2, game_started_at: at(0) };

		it("builds one ordered delta frame per move", () => {
			const moves = playMoves([
				[[6, 4], [4, 4], 3],
				[[1, 3], [3, 3], 10],
				[[4, 4], [3, 3], 12],
			]);
			const frames = replayService.buildReplayFrames(game, [moves[2], moves[0], moves[1]]);

			expect(frames.map((f) => f.index)).toEqual([1, 2, 3]);
			expect(frames.map((f) => f.uci)).toEqual(["e2e4", "d7d5", "e4d5"]);
			expect(frames.map((f) => f.durationMs)).toEqual([3000, 7000, 2000]);
			expect(frames[0]).toMatchObject({
				moveNumber: 1,
				player: "white",
				piece: "P",
				captured: null,
				fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b - - 0 1",
				playedAt: at(3),
			});
			expect(frames[2].captured).toBe("p");
		});

		it("decrements the mover's clock by the move duration and adds the increment", () => {
			const moves = playMoves([
				[[6, 4], [4, 4], 3],
				[[1, 4], [3, 4], 10],
				[[7, 6], [5, 5], 12],
			]);
			const frames = replayService.buildReplayFrames(game, moves);

			expect(frames[0].clock).toEqual({ whiteMs: 300000 - 3000 + 2000, blackMs: 300000 });
			expect(frames[1].clock).toEqual({ whiteMs: 299000, blackMs: 300000 - 7000 + 2000 });
			expect(frames[2].clock).toEqual({ whiteMs: 299000 - 2000 + 2000, blackMs: 295000 });
		});

		it("omits clocks for untimed games and tolerates missing timestamps", () => {
			const moves = playMoves([[[6, 4], [4, 4], 3]]);
			moves[0].created_at = null;
			const [frame] = replayService.buildReplayFrames({}, moves);

			expect(frame.clock).toBeNull();
			expect(frame.durationMs).toBe(0);
			expect(frame.playedAt).toBeNull();
		});

		it("detects en-passant captures, where the target square was empty", () => {
			const moves = playMoves([
				[[6, 4], [4, 4], 1],
				[[1, 0], [2, 0], 2],
				[[4, 4], [3, 4], 3],
				[[1, 3], [3, 3], 4],
				[[3, 4], [2, 3], 5, { enPassant: true }],
			]);
			const frames = replayService.buildReplayFrames(game, moves);

			expect(frames[4].uci).toBe("e5d6");
			expect(frames[4].captured).toBe("p");
		});
	});

	describe("formatSSE", () => {
		it("serialises id, event and single-line JSON data terminated by a blank line", () => {
			expect(replayService.formatSSE({ event: "move", id: 3, data: { uci: "e2e4", note: "a\nb" } })).toBe(
				'id: 3\nevent: move\ndata: {"uci":"e2e4","note":"a\\nb"}\n\n',
			);
		});

		it("omits the id line when there is no id", () => {
			expect(replayService.formatSSE({ event: "end", data: { winner: "white" } })).toBe(
				'event: end\ndata: {"winner":"white"}\n\n',
			);
		});
	});
});

describe("annotated PGN export (Issue #463)", () => {
	const { parsePgnStream } = require("../services/pgnService");

	const timedGame = {
		id: "11111111-2222-4333-8444-555555555555",
		game_code: "PGN1",
		status: "finished",
		winner: "white",
		end_reason: "resignation",
		player_white_address: "GWHITE",
		player_black_address: "GBLACK",
		time_control_seconds: 180,
		time_increment_seconds: 0,
		game_started_at: at(0),
		escrow_tx_hash: "a1b2c3d4",
	};

	async function parseOne(pgn) {
		const games = [];
		for await (const game of parsePgnStream(pgn)) games.push(game);
		expect(games).toHaveLength(1);
		return games[0];
	}

	describe("formatClockComment", () => {
		it("formats remaining seconds as [%clk H:MM:SS]", () => {
			expect(replayService.formatClockComment(178)).toBe("[%clk 0:02:58]");
			expect(replayService.formatClockComment(3725.9)).toBe("[%clk 1:02:05]");
			expect(replayService.formatClockComment(0)).toBe("[%clk 0:00:00]");
		});

		it("clamps negatives and ignores missing values", () => {
			expect(replayService.formatClockComment(-4)).toBe("[%clk 0:00:00]");
			expect(replayService.formatClockComment(null)).toBeNull();
			expect(replayService.formatClockComment(Number.NaN)).toBeNull();
		});
	});

	describe("formatEvalComment", () => {
		it("formats pawn, centipawn and mate scores", () => {
			expect(replayService.formatEvalComment({ evalScore: 0.85 })).toBe("[%eval 0.85]");
			expect(replayService.formatEvalComment({ evaluation_cp: -120 })).toBe("[%eval -1.20]");
			expect(replayService.formatEvalComment({ mateIn: -3 })).toBe("[%eval #-3]");
			expect(replayService.formatEvalComment({})).toBeNull();
		});
	});

	it("formats the TimeControl tag as base+increment seconds", () => {
		expect(replayService.formatTimeControl({ time_control_seconds: 300, time_increment_seconds: 2 })).toBe("300+2");
		expect(replayService.formatTimeControl({ time_control_seconds: 60 })).toBe("60+0");
		expect(replayService.formatTimeControl({})).toBe("-");
	});

	it("maps end reasons onto PGN Termination values", () => {
		expect(replayService.pgnTermination({ status: "finished", end_reason: "time" })).toBe("time forfeit");
		expect(replayService.pgnTermination({ status: "finished", end_reason: "disconnect" })).toBe("abandoned");
		expect(replayService.pgnTermination({ status: "finished", end_reason: "resignation" })).toBe("normal");
		expect(replayService.pgnTermination({ status: "active" })).toBe("unterminated");
	});

	it("annotates every move with the mover's remaining clock", () => {
		const moves = playMoves([
			[[6, 4], [4, 4], 2],
			[[1, 2], [3, 2], 3],
		]);
		const pgn = replayService.formatPgn(timedGame, moves, { ratings: { white: 1510, black: 1490 } });

		expect(pgn.split("\n\n")[1]).toBe("1. e4 { [%clk 0:02:58] } 1... c5 { [%clk 0:02:59] } 1-0\n");
	});

	it("includes Elo, TimeControl, Termination, Annotator and Stellar transaction tags", () => {
		const pgn = replayService.formatPgn(timedGame, [], { ratings: { white: 1510, black: null } });

		expect(pgn).toContain('[Result "1-0"]');
		expect(pgn).toContain('[WhiteElo "1510"]');
		expect(pgn).toContain('[BlackElo "?"]');
		expect(pgn).toContain('[TimeControl "180+0"]');
		expect(pgn).toContain('[Termination "normal"]');
		expect(pgn).toContain('[Annotator "Chesster"]');
		expect(pgn).toContain('[StellarTransactionId "a1b2c3d4"]');
		expect(pgn).toContain('[Date "2026.03.01"]');
	});

	it("prefers stored per-move clocks and adds engine evaluations", () => {
		const moves = playMoves([
			[[6, 4], [4, 4], 2],
			[[1, 4], [3, 4], 4],
		]);
		moves[0].clockRemainingMs = 175_400;
		moves[0].evalScore = 0.3;
		moves[1].evaluation_cp = -15;

		const movetext = replayService.formatPgn(timedGame, moves).split("\n\n")[1];
		expect(movetext).toBe("1. e4 { [%eval 0.30] [%clk 0:02:55] } 1... e5 { [%eval -0.15] [%clk 0:02:58] } 1-0\n");
	});

	it("omits clock comments and continuation numbers for untimed games", () => {
		const moves = playMoves([
			[[6, 4], [4, 4], 2],
			[[1, 4], [3, 4], 4],
			[[7, 6], [5, 5], 6],
		]);
		const untimed = { ...timedGame, time_control_seconds: null, winner: null, status: "active" };
		const pgn = replayService.formatPgn(untimed, moves);

		expect(pgn).toContain('[TimeControl "-"]');
		expect(pgn).toContain('[Termination "unterminated"]');
		expect(pgn.split("\n\n")[1]).toBe("1. e4 e5 2. Nf3 *\n");
	});

	it("writes standard SAN for en passant, disambiguation, checks and castling", () => {
		const moves = playMoves([
			[[6, 4], [4, 4], 1], [[0, 6], [2, 5], 2], [[4, 4], [3, 4], 3], [[1, 3], [3, 3], 4],
			[[3, 4], [2, 3], 5, { enPassant: true }], [[0, 1], [2, 2], 6], [[7, 6], [5, 5], 7], [[2, 2], [4, 1], 8],
			[[7, 1], [5, 2], 9], [[4, 1], [3, 3], 10], [[2, 3], [1, 2], 11], [[0, 3], [1, 3], 12],
			[[7, 5], [3, 1], 13], [[1, 3], [3, 1], 14], [[5, 2], [3, 1], 15], [[1, 0], [2, 0], 16],
			[[3, 1], [2, 3], 17], [[1, 4], [2, 3], 18],
		]);
		const untimed = { ...timedGame, time_control_seconds: null };
		const sans = replayService.formatPgn(untimed, moves).split("\n\n")[1]
			.trim().split(" ").filter((token) => !/^\d+\.$/.test(token) && token !== "1-0");

		expect(sans).toEqual([
			"e4", "Nf6", "e5", "d5", "exd6", "Nc6", "Nf3", "Nb4", "Nc3", "Nbd5",
			"dxc7", "Qd7", "Bb5", "Qxb5", "Nxb5", "a6", "Nd6+", "exd6",
		]);
	});

	it("reconstructs castling from move rows stored without board snapshots", () => {
		const moves = playMoves([
			[[6, 4], [4, 4], 1], [[1, 4], [3, 4], 2], [[7, 6], [5, 5], 3], [[0, 1], [2, 2], 4],
			[[7, 5], [4, 2], 5], [[0, 6], [2, 5], 6], [[7, 4], [7, 6], 7], [[2, 5], [4, 4], 8],
			[[7, 5], [7, 4], 9],
		]).map(({ board_state_after, ...row }) => row);
		const untimed = { ...timedGame, time_control_seconds: null };

		expect(replayService.formatPgn(untimed, moves).split("\n\n")[1])
			.toBe("1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. O-O Nxe4 5. Re1 1-0\n");
	});

	it("produces PGN that round-trips through the PGN importer with clocks intact", async () => {
		const moves = playMoves([
			[[6, 4], [4, 4], 2], [[1, 4], [3, 4], 5], [[7, 6], [5, 5], 9],
			[[0, 1], [2, 2], 10], [[7, 5], [3, 1], 30], [[1, 0], [2, 0], 31],
		]);
		const pgn = replayService.formatPgn({ ...timedGame, time_increment_seconds: 2 }, moves);
		const parsed = await parseOne(pgn);

		expect(parsed.valid).toBe(true);
		expect(parsed.headers).toMatchObject({ TimeControl: "180+2", Annotator: "Chesster", Result: "1-0" });
		expect(parsed.moves.map((m) => m.san)).toEqual(["e4", "e5", "Nf3", "Nc6", "Bb5", "a6"]);
		expect(parsed.moves.map((m) => m.clock)).toEqual(["0:03:00", "0:02:59", "0:02:58", "0:03:00", "0:02:40", "0:03:01"]);
	});

	describe("generatePgn", () => {
		function fakeDb(tables) {
			const queries = [];
			return {
				queries,
				from(table) {
					const filters = {};
					const builder = {
						select() { return this; },
						eq(key, value) { filters[key] = value; return this; },
						order() { return this; },
						limit() { return this; },
						maybeSingle() {
							queries.push({ table, filters: { ...filters } });
							const rows = (tables[table] || []).filter((row) => Object.entries(filters).every(([k, v]) => row[k] === v));
							return Promise.resolve({ data: rows[0] || null, error: null });
						},
						then(resolve, reject) {
							queries.push({ table, filters: { ...filters } });
							const rows = (tables[table] || []).filter((row) => Object.entries(filters).every(([k, v]) => row[k] === v));
							return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
						},
					};
					return builder;
				},
			};
		}

		const moveRows = () => playMoves([[[6, 4], [4, 4], 2], [[1, 2], [3, 2], 3]]).map((row) => ({ ...row, game_id: timedGame.id }));

		it("loads the game, moves and pre-game ratings by id", async () => {
			const db = fakeDb({
				games: [timedGame],
				moves: moveRows(),
				player_rating_history: [{ game_id: timedGame.id, wallet_address: "GWHITE", old_rating: 1600 }],
				players: [{ wallet_address: "GWHITE", elo_rating: 1650 }, { wallet_address: "GBLACK", elo_rating: 1420 }],
			});

			const pgn = await replayService.generatePgn(timedGame.id, db);

			expect(db.queries[0]).toEqual({ table: "games", filters: { id: timedGame.id } });
			expect(pgn).toContain('[WhiteElo "1600"]');
			expect(pgn).toContain('[BlackElo "1420"]');
			expect(pgn).toContain("1. e4 { [%clk 0:02:58] } 1... c5 { [%clk 0:02:59] } 1-0");
		});

		it("accepts a game code and rejects unknown games with a 404", async () => {
			const db = fakeDb({ games: [timedGame], moves: moveRows() });

			await expect(replayService.generatePgn("PGN1", db)).resolves.toContain('[White "GWHITE"]');
			await expect(replayService.generatePgn("NOPE", db)).rejects.toMatchObject({ statusCode: 404 });
		});

		it("falls back to unknown ratings when the lookup fails", async () => {
			const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
			const db = {
				from() {
					return {
						select() { return this; },
						eq() { return this; },
						limit() { return Promise.resolve({ data: null, error: new Error("db down") }); },
					};
				},
			};

			await expect(replayService.fetchPlayerRatings(timedGame, db)).resolves.toEqual({ white: null, black: null });
			warn.mockRestore();
		});
	});
});
