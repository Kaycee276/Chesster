import {
	fenSideToMove,
	parseUciInfo,
	toWhitePerspective,
	type EngineEvaluation,
} from "../utils/engineEvaluation";

export const DEFAULT_SEARCH_DEPTH = 12;

/** Messages sent from the UI thread to the Stockfish worker. */
export type EngineRequest =
	| { type: "evaluate"; fen: string; depth?: number }
	| { type: "stop" };

/** Messages sent from the Stockfish worker back to the UI thread. */
export type EngineResponse =
	| { type: "ready" }
	| { type: "evaluation"; evaluation: EngineEvaluation }
	| { type: "error"; message: string };

/** Minimal UCI engine surface: accepts one UCI command per call. */
export interface UciEngine {
	postMessage(command: string): void;
}

interface Search {
	fen: string;
	depth: number;
}

/**
 * Drives a UCI engine for continuous position evaluation.
 *
 * Only one search runs at a time. When a new position arrives mid-search the
 * running search is stopped and its output discarded; the newest position
 * starts as soon as the engine acknowledges the stop with `bestmove`. Scores
 * are converted to White's perspective before being emitted.
 */
export class EngineController {
	private readonly engine: UciEngine;
	private readonly emit: (message: EngineResponse) => void;
	private ready = false;
	private current: Search | null = null;
	private pending: Search | null = null;
	private stopping = false;
	private latest: EngineEvaluation | null = null;

	constructor(engine: UciEngine, emit: (message: EngineResponse) => void) {
		this.engine = engine;
		this.emit = emit;
	}

	start(): void {
		this.engine.postMessage("uci");
	}

	handleRequest(request: EngineRequest): void {
		if (request.type === "evaluate") {
			const depth = request.depth ?? DEFAULT_SEARCH_DEPTH;
			const current = this.current;
			// Already searching this exact position: let the search continue.
			if (current && !this.stopping && current.fen === request.fen && current.depth === depth) {
				this.pending = null;
				return;
			}
			this.pending = { fen: request.fen, depth };
			if (current) this.stopCurrent();
			else this.startPending();
		} else if (request.type === "stop") {
			this.pending = null;
			if (this.current) this.stopCurrent();
		}
	}

	/** Feeds raw engine output (may contain several newline-separated lines). */
	handleEngineOutput(output: string): void {
		for (const line of output.split("\n")) {
			this.handleEngineLine(line.trim());
		}
	}

	private handleEngineLine(line: string): void {
		if (line === "uciok") {
			this.engine.postMessage("isready");
		} else if (line === "readyok") {
			if (this.ready) return;
			this.ready = true;
			this.emit({ type: "ready" });
			this.startPending();
		} else if (line.startsWith("info ")) {
			this.handleInfo(line);
		} else if (line.startsWith("bestmove")) {
			this.handleBestMove(line);
		}
	}

	private handleInfo(line: string): void {
		if (!this.current || this.stopping) return;

		const info = parseUciInfo(line);
		// Bound scores come from aspiration re-searches and would make the bar
		// jitter; secondary PV lines are not the engine's main evaluation.
		if (!info || info.bound || info.multipv !== 1) return;

		this.latest = {
			fen: this.current.fen,
			depth: info.depth,
			...toWhitePerspective(info.score, fenSideToMove(this.current.fen)),
			bestMove: info.pv[0] ?? null,
			final: false,
		};
		this.emit({ type: "evaluation", evaluation: this.latest });
	}

	private handleBestMove(line: string): void {
		const finished = this.current;
		const wasStopped = this.stopping;
		const latest = this.latest;

		this.current = null;
		this.stopping = false;
		this.latest = null;

		if (finished && !wasStopped && latest) {
			const move = line.split(/\s+/)[1];
			this.emit({
				type: "evaluation",
				evaluation: {
					...latest,
					bestMove: move && move !== "(none)" ? move : null,
					final: true,
				},
			});
		}

		this.startPending();
	}

	private stopCurrent(): void {
		if (this.stopping) return;
		this.stopping = true;
		this.engine.postMessage("stop");
	}

	private startPending(): void {
		if (!this.ready || this.current || !this.pending) return;

		this.current = this.pending;
		this.pending = null;
		this.latest = null;
		this.engine.postMessage(`position fen ${this.current.fen}`);
		this.engine.postMessage(`go depth ${this.current.depth}`);
	}
}
