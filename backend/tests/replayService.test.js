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
