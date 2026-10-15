import {
	fenSideToMove,
	parseUciInfo,
	toWhitePerspective,
	type EngineEvaluation,
	type EngineMetrics,
} from "../utils/engineEvaluation";

export type { EngineMetrics };

export const DEFAULT_SEARCH_DEPTH = 12;

/** Messages sent from the UI thread to the Stockfish worker. */
export type EngineRequest =
	| { type: "evaluate"; fen: string; depth?: number }
	| { type: "stop" }
	| { type: "setDepth"; depth: number }
	| { type: "setMultiPv"; lines: number }
	| { type: "configure"; depth: number; multiPv: number };

/** Messages sent from the Stockfish worker back to the UI thread. */
export type EngineResponse =
	| { type: "ready" }
	| { type: "evaluation"; evaluation: EngineEvaluation }
	| { type: "metrics"; metrics: EngineMetrics }
	| { type: "error"; message: string };

/** Minimal UCI engine surface: accepts one UCI command per call. */
export interface UciEngine {
	postMessage(command: string): void;
}

interface Search {
	fen: string;
	depth: number;
}

let activeWorker: UciEngine | null = null;

export function setActiveWorker(worker: UciEngine | null) {
	activeWorker = worker;
}

export function configureEngine(depth: number, multiPv: number, worker?: UciEngine) {
	const target = worker ?? activeWorker;
	if (target) {
		target.postMessage(`setoption name MultiPV value ${multiPv}`);
		target.postMessage(`go depth ${depth}`);
	}
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
	private defaultDepth = DEFAULT_SEARCH_DEPTH;
	private multiPv = 1;

	constructor(engine: UciEngine, emit: (message: EngineResponse) => void) {
		this.engine = engine;
		this.emit = emit;
		setActiveWorker(engine);
	}

	start(): void {
		this.engine.postMessage("uci");
	}

	setDepth(depth: number): void {
		this.defaultDepth = depth;
		if (this.current && !this.stopping && this.current.depth !== depth) {
			const fen = this.current.fen;
			this.pending = { fen, depth };
			this.stopCurrent();
		}
	}

	setMultiPv(lines: number): void {
		this.multiPv = lines;
		this.engine.postMessage(`setoption name MultiPV value ${lines}`);
		if (this.current && !this.stopping) {
			const { fen, depth } = this.current;
			this.pending = { fen, depth };
			this.stopCurrent();
		}
	}

	configureEngine(depth: number, multiPv: number): void {
		this.setMultiPv(multiPv);
		this.setDepth(depth);
	}

	handleRequest(request: EngineRequest): void {
		if (request.type === "evaluate") {
			const depth = request.depth ?? this.defaultDepth;
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
		} else if (request.type === "setDepth") {
			this.setDepth(request.depth);
		} else if (request.type === "setMultiPv") {
			this.setMultiPv(request.lines);
		} else if (request.type === "configure") {
			this.configureEngine(request.depth, request.multiPv);
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
		// jitter; secondary PV lines are ignored if multiPv is 1 or beyond configured lines.
		if (!info || info.bound) return;
		if (info.multipv > this.multiPv) return;

		const whiteScore = toWhitePerspective(info.score, fenSideToMove(this.current.fen));
		const metrics: EngineMetrics = {
			depth: info.depth,
			seldepth: info.seldepth ?? info.depth,
			score: info.score,
			multipv: info.multipv,
			nps: info.nps ?? 0,
			pv: info.pv,
		};

		const evaluation: EngineEvaluation = {
			fen: this.current.fen,
			depth: info.depth,
			...whiteScore,
			bestMove: info.pv[0] ?? null,
			final: false,
		};

		if (info.seldepth !== undefined) evaluation.seldepth = info.seldepth;
		if (info.nps !== undefined) evaluation.nps = info.nps;
		if (info.multipv > 1) evaluation.multipv = info.multipv;
		if (info.pv.length > 0 && (info.seldepth !== undefined || info.nps !== undefined || info.multipv > 1)) {
			evaluation.pv = info.pv;
		}
		if (info.seldepth !== undefined || info.nps !== undefined || info.multipv > 1) {
			evaluation.metrics = metrics;
		}

		if (info.multipv === 1) {
			this.latest = evaluation;
		}

		this.emit({ type: "evaluation", evaluation });
		if (info.seldepth !== undefined || info.nps !== undefined) {
			this.emit({ type: "metrics", metrics });
		}
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
