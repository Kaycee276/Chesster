const { EventEmitter } = require("events");
const express = require("express");
const request = require("supertest");
const chessEngine = require("../services/chessEngine");

jest.mock("../models/gameModel", () => ({ getGame: jest.fn(), getMoves: jest.fn() }));
jest.mock("../services/timerService", () => ({}));

const gameModel = require("../models/gameModel");
const gameController = require("../controllers/gameController");
const gameRoutes = require("../routes/gameRoutes");

const T0 = Date.parse("2026-03-01T12:00:00.000Z");
const at = (ms) => new Date(T0 + ms).toISOString();

const GAME = {
	game_code: "RPLY01",
	status: "finished",
	winner: "black",
	end_reason: "resignation",
	player_white_address: "GWHITE",
	player_black_address: "GBLACK",
	time_control_seconds: 60,
	time_increment_seconds: 0,
	game_started_at: at(0),
};

/** Three moves played `gapsMs` apart (first gap measured from game start). */
function movesWithGaps(gapsMs) {
	const plies = [[[6, 4], [4, 4]], [[1, 4], [3, 4]], [[7, 6], [5, 5]]];
	let board = chessEngine.initBoard();
	let elapsed = 0;
	return plies.map(([from, to], i) => {
		const piece = board[from[0]][from[1]];
		board = chessEngine.makeMove(board, from, to);
		elapsed += gapsMs[i];
		return {
			move_number: i + 1,
			player: i % 2 === 0 ? "white" : "black",
			from_position: from,
			to_position: to,
			piece,
			board_state_after: board,
			created_at: at(elapsed),
		};
	});
}

/** Parse an event-stream body into [{ id, event, data }] (comments skipped). */
function parseEvents(body) {
	return body
		.split("\n\n")
		.filter((block) => block.trim() && !block.startsWith(":") && !block.startsWith("retry:"))
		.map((block) => {
			const fields = {};
			for (const line of block.split("\n")) {
				const idx = line.indexOf(": ");
				fields[line.slice(0, idx)] = line.slice(idx + 2);
			}
			return { id: fields.id, event: fields.event, data: JSON.parse(fields.data) };
		});
}

/** Minimal req/res pair for driving the handler under fake timers. */
function mockExchange({ query = {}, headers = {} } = {}) {
	const res = new EventEmitter();
	res.chunks = [];
	res.ended = false;
	res.writeHead = jest.fn();
	res.status = jest.fn(() => res);
	res.json = jest.fn();
	res.write = jest.fn((chunk) => {
		res.chunks.push(chunk);
		return true;
	});
	res.end = jest.fn(() => {
		res.ended = true;
		res.emit("close");
	});
	const req = { params: { id: "RPLY01" }, query, headers };
	return { req, res, events: () => parseEvents(res.chunks.join("")) };
}

function buildApp() {
	const app = express();
	app.use("/api", gameRoutes);
	return app;
}

describe("GET /api/games/:id/stream", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		gameModel.getGame.mockResolvedValue(GAME);
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it("streams start, move and end events as a valid text/event-stream", async () => {
		gameModel.getMoves.mockResolvedValue(movesWithGaps([30, 20, 10]));

		const res = await request(buildApp()).get("/api/games/RPLY01/stream?speed=10");

		expect(res.status).toBe(200);
		expect(res.headers["content-type"]).toBe("text/event-stream; charset=utf-8");
		expect(res.headers["cache-control"]).toBe("no-cache, no-transform");
		expect(res.headers.connection).toBe("keep-alive");
		expect(res.text.startsWith("retry: 3000\n\n")).toBe(true);

		const events = parseEvents(res.text);
		expect(events.map((e) => e.event)).toEqual(["start", "move", "move", "move", "end"]);
		expect(events[0].data).toMatchObject({ gameCode: "RPLY01", speed: 10, totalMoves: 3, resumeFrom: 0 });

		const moves = events.filter((e) => e.event === "move");
		expect(moves.map((e) => e.id)).toEqual(["1", "2", "3"]);
		expect(moves.map((e) => e.data.uci)).toEqual(["e2e4", "e7e5", "g1f3"]);
		expect(moves[0].data).toMatchObject({
			index: 1,
			player: "white",
			piece: "P",
			captured: null,
			durationMs: 30,
			clock: { whiteMs: 59970, blackMs: 60000 },
			fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b - - 0 1",
		});
		expect(events[4].data).toEqual({ gameCode: "RPLY01", status: "finished", winner: "black", endReason: "resignation" });
	});

	it("returns 404 when the game does not exist", async () => {
		gameModel.getGame.mockRejectedValue(new Error("Game not found"));

		const res = await request(buildApp()).get("/api/games/NOPE00/stream");

		expect(res.status).toBe(404);
		expect(res.headers["content-type"]).toMatch(/json/);
	});

	it("returns 400 for a non-numeric speed", async () => {
		const res = await request(buildApp()).get("/api/games/RPLY01/stream?speed=fast");
		expect(res.status).toBe(400);
	});

	it("paces moves by original duration divided by the speed multiplier", async () => {
		jest.useFakeTimers();
		gameModel.getMoves.mockResolvedValue(movesWithGaps([4000, 2000, 1000]));
		const { req, res, events } = mockExchange({ query: { speed: "2" } });

		await gameController.streamGameReplay(req, res);
		const moveCount = () => events().filter((e) => e.event === "move").length;

		expect(moveCount()).toBe(0);
		await jest.advanceTimersByTimeAsync(1999);
		expect(moveCount()).toBe(0);
		await jest.advanceTimersByTimeAsync(1); // 4000ms / 2
		expect(moveCount()).toBe(1);
		await jest.advanceTimersByTimeAsync(999);
		expect(moveCount()).toBe(1);
		await jest.advanceTimersByTimeAsync(1); // 2000ms / 2
		expect(moveCount()).toBe(2);
		await jest.advanceTimersByTimeAsync(500); // 1000ms / 2
		expect(events().map((e) => e.event)).toEqual(["start", "move", "move", "move", "end"]);
		expect(res.ended).toBe(true);
		expect(jest.getTimerCount()).toBe(0);
	});

	it("delivers the whole replay faster at 5x than at 1x", async () => {
		jest.useFakeTimers();
		gameModel.getMoves.mockResolvedValue(movesWithGaps([4000, 2000, 1000]));

		const fast = mockExchange({ query: { speed: "5" } });
		await gameController.streamGameReplay(fast.req, fast.res);
		const slow = mockExchange({ query: { speed: "1" } });
		await gameController.streamGameReplay(slow.req, slow.res);

		await jest.advanceTimersByTimeAsync(7000 / 5);
		expect(fast.res.ended).toBe(true);
		expect(slow.res.ended).toBe(false);
		await jest.advanceTimersByTimeAsync(7000 - 7000 / 5);
		expect(slow.res.ended).toBe(true);
	});

	it("clears all timers and stops writing when the client disconnects", async () => {
		jest.useFakeTimers();
		gameModel.getMoves.mockResolvedValue(movesWithGaps([1000, 1000, 1000]));
		const { req, res, events } = mockExchange();

		await gameController.streamGameReplay(req, res);
		await jest.advanceTimersByTimeAsync(1000);
		expect(events().filter((e) => e.event === "move")).toHaveLength(1);
		expect(jest.getTimerCount()).toBe(2); // next move + heartbeat

		res.emit("close");
		expect(jest.getTimerCount()).toBe(0);

		const written = res.write.mock.calls.length;
		await jest.advanceTimersByTimeAsync(60000);
		expect(res.write.mock.calls.length).toBe(written);
		expect(res.end).not.toHaveBeenCalled();
	});

	it("sends keep-alive comments while waiting between moves", async () => {
		jest.useFakeTimers();
		// Each 60s think is capped at 10s, so the stream is still open at 15s.
		gameModel.getMoves.mockResolvedValue(movesWithGaps([60000, 60000, 60000]));
		const { req, res } = mockExchange();

		await gameController.streamGameReplay(req, res);
		await jest.advanceTimersByTimeAsync(15000);

		expect(res.chunks).toContain(": keep-alive\n\n");
		res.emit("close");
	});

	it("resumes after the Last-Event-ID the client already received", async () => {
		jest.useFakeTimers();
		gameModel.getMoves.mockResolvedValue(movesWithGaps([10, 10, 10]));
		const { req, res, events } = mockExchange({ headers: { "last-event-id": "2" } });

		await gameController.streamGameReplay(req, res);
		await jest.advanceTimersByTimeAsync(100);

		const received = events();
		expect(received[0].data.resumeFrom).toBe(2);
		expect(received.filter((e) => e.event === "move").map((e) => e.id)).toEqual(["3"]);
		expect(res.ended).toBe(true);
	});

	it("waits for the socket to drain before sending the next move", async () => {
		jest.useFakeTimers();
		gameModel.getMoves.mockResolvedValue(movesWithGaps([10, 10, 10]));
		const { req, res, events } = mockExchange();
		res.write.mockImplementation((chunk) => {
			res.chunks.push(chunk);
			return !chunk.includes("event: move");
		});

		await gameController.streamGameReplay(req, res);
		await jest.advanceTimersByTimeAsync(1000);
		expect(events().filter((e) => e.event === "move")).toHaveLength(1);

		res.emit("drain");
		await jest.advanceTimersByTimeAsync(10);
		expect(events().filter((e) => e.event === "move")).toHaveLength(2);
		res.emit("close");
	});
});
