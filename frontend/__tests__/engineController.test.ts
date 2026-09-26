import { describe, it, expect, beforeEach } from "vitest";
import { EngineController, type EngineResponse } from "../src/workers/engineController";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";

describe("EngineController", () => {
	let commands: string[];
	let emitted: EngineResponse[];
	let controller: EngineController;

	const evaluations = () =>
		emitted.flatMap((m) => (m.type === "evaluation" ? [m.evaluation] : []));

	function boot() {
		controller.start();
		controller.handleEngineOutput("id name Stockfish\nuciok");
		controller.handleEngineOutput("readyok");
	}

	beforeEach(() => {
		commands = [];
		emitted = [];
		controller = new EngineController(
			{ postMessage: (cmd) => commands.push(cmd) },
			(msg) => emitted.push(msg),
		);
	});

	it("performs the UCI handshake and reports readiness once", () => {
		boot();
		controller.handleEngineOutput("readyok");

		expect(commands).toEqual(["uci", "isready"]);
		expect(emitted).toEqual([{ type: "ready" }]);
	});

	it("queues positions requested before the engine is ready", () => {
		controller.start();
		controller.handleRequest({ type: "evaluate", fen: START });
		expect(commands).toEqual(["uci"]);

		controller.handleEngineOutput("uciok");
		controller.handleEngineOutput("readyok");
		expect(commands).toEqual(["uci", "isready", `position fen ${START}`, "go depth 12"]);
	});

	it("honours a custom depth", () => {
		boot();
		controller.handleRequest({ type: "evaluate", fen: START, depth: 18 });
		expect(commands.at(-1)).toBe("go depth 18");
	});

	it("streams evaluations and emits a final result on bestmove", () => {
		boot();
		controller.handleRequest({ type: "evaluate", fen: START });

		controller.handleEngineOutput("info depth 1 score cp 20 pv e2e4");
		controller.handleEngineOutput("info depth 5 currmove d2d4 currmovenumber 2");
		controller.handleEngineOutput("info depth 12 multipv 1 score cp 35 nodes 1000 pv d2d4 d7d5");
		controller.handleEngineOutput("bestmove d2d4 ponder d7d5");

		expect(evaluations()).toEqual([
			{ fen: START, depth: 1, scoreCp: 20, mate: null, bestMove: "e2e4", final: false },
			{ fen: START, depth: 12, scoreCp: 35, mate: null, bestMove: "d2d4", final: false },
			{ fen: START, depth: 12, scoreCp: 35, mate: null, bestMove: "d2d4", final: true },
		]);
	});

	it("converts Black-to-move scores to White's perspective", () => {
		boot();
		controller.handleRequest({ type: "evaluate", fen: AFTER_E4 });
		controller.handleEngineOutput("info depth 10 score cp -40 pv e7e5");
		controller.handleEngineOutput("info depth 11 score mate 3 pv d8h4");

		expect(evaluations().map((e) => [e.scoreCp, e.mate])).toEqual([
			[40, null],
			[-100_000, -3],
		]);
	});

	it("ignores bound scores and secondary PV lines", () => {
		boot();
		controller.handleRequest({ type: "evaluate", fen: START });
		controller.handleEngineOutput("info depth 9 score cp 90 lowerbound");
		controller.handleEngineOutput("info depth 9 multipv 2 score cp -10 pv a2a3");
		expect(evaluations()).toHaveLength(0);
	});

	it("stops a running search when a new position arrives and discards its output", () => {
		boot();
		controller.handleRequest({ type: "evaluate", fen: START });
		controller.handleEngineOutput("info depth 4 score cp 25 pv e2e4");

		controller.handleRequest({ type: "evaluate", fen: AFTER_E4 });
		expect(commands.at(-1)).toBe("stop");

		// Output from the stopped search is ignored.
		controller.handleEngineOutput("info depth 5 score cp 30 pv e2e4");
		controller.handleEngineOutput("bestmove e2e4");

		expect(commands.slice(-2)).toEqual([`position fen ${AFTER_E4}`, "go depth 12"]);
		expect(evaluations().filter((e) => e.final)).toHaveLength(0);
		expect(evaluations().every((e) => e.fen === START && e.depth === 4)).toBe(true);
	});

	it("only searches the newest of several rapid positions", () => {
		boot();
		controller.handleRequest({ type: "evaluate", fen: START });
		controller.handleRequest({ type: "evaluate", fen: "fen-2" });
		controller.handleRequest({ type: "evaluate", fen: AFTER_E4 });

		expect(commands.filter((c) => c === "stop")).toHaveLength(1);
		controller.handleEngineOutput("bestmove e2e4");
		expect(commands.filter((c) => c.startsWith("position"))).toEqual([
			`position fen ${START}`,
			`position fen ${AFTER_E4}`,
		]);
	});

	it("does not restart a search for the position already being evaluated", () => {
		boot();
		controller.handleRequest({ type: "evaluate", fen: START });
		controller.handleRequest({ type: "evaluate", fen: START });
		expect(commands).not.toContain("stop");
	});

	it("pauses on stop without emitting a final result", () => {
		boot();
		controller.handleRequest({ type: "evaluate", fen: START });
		controller.handleEngineOutput("info depth 6 score cp 25 pv e2e4");

		controller.handleRequest({ type: "stop" });
		expect(commands.at(-1)).toBe("stop");
		controller.handleEngineOutput("bestmove e2e4");

		expect(evaluations().some((e) => e.final)).toBe(false);
		expect(commands.filter((c) => c.startsWith("go"))).toHaveLength(1);
	});

	it("ignores stop requests while idle", () => {
		boot();
		controller.handleRequest({ type: "stop" });
		expect(commands).toEqual(["uci", "isready"]);
	});

	it("reports checkmate positions with no best move", () => {
		const mated = "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3";
		boot();
		controller.handleRequest({ type: "evaluate", fen: mated });
		controller.handleEngineOutput("info depth 0 score mate 0");
		controller.handleEngineOutput("bestmove (none)");

		expect(evaluations().at(-1)).toEqual({
			fen: mated,
			depth: 0,
			scoreCp: -100_000,
			mate: 0,
			bestMove: null,
			final: true,
		});
	});
});
