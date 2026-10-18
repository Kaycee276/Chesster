import { useEffect, useMemo, useRef, useState } from "react";
import { INITIAL_BOARD } from "../utils/chessUtils";
import { toEngineFen } from "../utils/engineEvaluation";
import {
	analyzeAccuracy,
	type AccuracySummary,
	type MoveClassification,
	type MoveQuality,
	moveAccuracyPercent,
	meanCpl,
} from "../utils/moveAccuracy";
import type { ReplayedMove } from "../utils/pgnParser";
import { EngineController, type EngineResponse } from "../workers/engineController";
import { soundService } from "../services/soundService";

/** Relative piece values for computing material counts */
export const SACRIFICE_PIECE_VALUES: Record<string, number> = {
	P: 1,
	N: 3,
	B: 3,
	R: 5,
	Q: 9,
	K: 0,
	p: 1,
	n: 3,
	b: 3,
	r: 5,
	q: 9,
	k: 0,
};

/** Compute total piece material count for a side on a board */
export function computeMaterial(board: string[][], color: "white" | "black"): number {
	let total = 0;
	for (const row of board) {
		for (const square of row) {
			if (square === ".") continue;
			const isWhite = square === square.toUpperCase();
			if ((color === "white" && isWhite) || (color === "black" && !isWhite)) {
				total += SACRIFICE_PIECE_VALUES[square] ?? 0;
			}
		}
	}
	return total;
}

/**
 * Checks whether a played move constitutes a material sacrifice:
 * gives up net piece material (relative piece values: P=1, N=3, B=3, R=5, Q=9),
 * leaves a piece undefended or captured on the next ply, while evaluation remains favorable.
 */
export function isMaterialSacrifice(
	move: ReplayedMove,
	boardBefore: string[][],
	nextMove?: ReplayedMove,
): boolean {
	const mover = move.color;
	const moverBefore = computeMaterial(boardBefore, mover);
	const moverAfter = computeMaterial(move.boardAfter, mover);

	const opponent = mover === "white" ? "black" : "white";
	const oppBefore = computeMaterial(boardBefore, opponent);
	const oppAfter = computeMaterial(move.boardAfter, opponent);

	// Net material change from mover's perspective: (moverAfter - moverBefore) - (oppAfter - oppBefore)
	const moverNetDiff = (moverAfter - moverBefore) - (oppAfter - oppBefore);
	if (moverNetDiff < 0) {
		return true;
	}

	// Or if on the next ply the opponent captures a piece that was left vulnerable
	if (nextMove && nextMove.color === opponent && nextMove.isCapture) {
		const nextBoardMaterial = computeMaterial(nextMove.boardAfter, mover);
		if (nextBoardMaterial < moverBefore) {
			return true;
		}
	}

	return false;
}

/**
 * Search depth used for whole-game accuracy analysis. Slightly lower than the
 * live evaluation bar: a full game needs one search per unique position, so
 * this keeps total analysis time reasonable while staying well above the
 * classification thresholds (the worst being ≥300 cp).
 */
export const ANALYSIS_SEARCH_DEPTH = 10;

export type AnalysisProgress = "idle" | "running" | "done";

export interface AccuracyAnalysis {
	moves: MoveClassification[];
	white: AccuracySummary;
	black: AccuracySummary;
}

export interface AnalysisState {
	progress: AnalysisProgress;
	/** Unique engine positions evaluated so far. */
	evaluated: number;
	/** Total unique engine positions to evaluate. */
	total: number;
	/** White-perspective scores, including the initial position. */
	evaluations: (number | null)[];
	result: AccuracyAnalysis | null;
}

interface RunState {
	/** FEN list this run belongs to (identity compare against the current one). */
	runFens: string[];
	evaluated: number;
	evaluations: (number | null)[];
	result: AccuracyAnalysis | null;
	/** Set when the engine failed and the run ended without results. */
	aborted: boolean;
}

/**
 * Runs Stockfish over every position of a game (start position + the position
 * after each ply) and classifies each move by centipawn loss.
 *
 * Positions are searched sequentially through one shared engine worker; a
 * position's final evaluation triggers the next one. Identical positions
 * (repetitions) are searched only once, and results arrive progressively so
 * the UI can show a completion counter.
 */
export function useMoveAccuracyAnalysis(
	moves: ReplayedMove[],
	{ depth = ANALYSIS_SEARCH_DEPTH, enabled = true }: { depth?: number; enabled?: boolean } = {},
): AnalysisState {
	// White-perspective evaluation for every position slot: slot 0 is the
	// start position, slot i + 1 is the position after move i.
	const evalSlots = useMemo<(string | null)[]>(() => {
		const slots: (string | null)[] = [toEngineFen(INITIAL_BOARD, moves[0]?.color ?? "white")];
		for (const move of moves) {
			const nextMover: "white" | "black" = move.color === "white" ? "black" : "white";
			slots.push(toEngineFen(move.boardAfter, nextMover));
		}
		return slots;
	}, [moves]);

	// Collapse identical positions so each unique FEN is searched only once.
	const { uniqueFens, slotToUnique } = useMemo(() => {
		const unique: string[] = [];
		const mapping: (number | null)[] = [];
		const seen = new Map<string, number>();
		for (const fen of evalSlots) {
			if (fen === null) {
				mapping.push(null);
				continue;
			}
			let idx = seen.get(fen);
			if (idx === undefined) {
				idx = unique.length;
				seen.set(fen, idx);
				unique.push(fen);
			}
			mapping.push(idx);
		}
		return { uniqueFens: unique, slotToUnique: mapping };
	}, [evalSlots]);

	const [run, setRun] = useState<RunState | null>(null);

	// The engine session lives for the component's lifetime while game
	// bookkeeping changes per game, so every worker callback reads through
	// refs to stay independent of any single render's closures.
	const uniqueFensRef = useRef(uniqueFens);
	const slotToUniqueRef = useRef(slotToUnique);
	const depthRef = useRef(depth);
	const readyRef = useRef(false);
	const resultsRef = useRef<(number | null)[]>([]);
	const nextRef = useRef(0);
	const inflightRef = useRef<number | null>(null);
	const controllerRef = useRef<EngineController | null>(null);

	useEffect(() => {
		depthRef.current = depth;
	}, [depth]);

	/** Sends the next unique position to the engine, if any is pending. */
	const pump = () => {
		const controller = controllerRef.current;
		if (!readyRef.current || !controller || inflightRef.current !== null) return;
		const next = nextRef.current;
		if (next >= uniqueFensRef.current.length) return;

		inflightRef.current = next;
		nextRef.current = next + 1;
		controller.handleRequest({
			type: "evaluate",
			fen: uniqueFensRef.current[next],
			depth: depthRef.current,
		});
	};

	const movesRef = useRef(moves);
	useEffect(() => {
		movesRef.current = moves;
	}, [moves]);

	/** Aggregates results once every unique position has been resolved. */
	const finishIfComplete = () => {
		if (nextRef.current < uniqueFensRef.current.length || inflightRef.current !== null) return;
		const evals = slotToUniqueRef.current.map(
			(idx) => (idx === null ? null : resultsRef.current[idx] ?? null),
		);

		const currentMoves = movesRef.current;
		const accuracyRes = analyzeAccuracy(evals);

		// Post-process classifications to detect "Brilliant" moves
		let hasBrilliant = false;
		for (let i = 0; i < accuracyRes.moves.length && i < currentMoves.length; i++) {
			const move = currentMoves[i];
			const boardBefore = i === 0 ? INITIAL_BOARD : currentMoves[i - 1].boardAfter;
			const nextMove = currentMoves[i + 1];
			const isSacrifice = isMaterialSacrifice(move, boardBefore, nextMove);

			const afterScore = evals[i + 1];
			const mover = move.color;
			const cpl = accuracyRes.moves[i].cpl;

			// Eval from moving player's perspective after the move
			const moverEvalAfter =
				afterScore === null ? 0 : mover === "white" ? afterScore : -afterScore;

			if (isSacrifice && cpl < 15 && moverEvalAfter >= 150) {
				accuracyRes.moves[i].quality = "brilliant";
				hasBrilliant = true;
			}
		}

		if (hasBrilliant) {
			try {
				soundService.brilliant();
			} catch {
				// AudioContext may be suspended or blocked
			}
		}

		// Recompute side summaries to accurately count 'brilliant' vs 'best'
		const whiteLosses: { cpl: number; quality: MoveQuality }[] = [];
		const blackLosses: { cpl: number; quality: MoveQuality }[] = [];
		for (let i = 0; i < accuracyRes.moves.length; i++) {
			const mover: "white" | "black" = i % 2 === 0 ? "white" : "black";
			if (evals[i] !== null && evals[i + 1] !== null) {
				(mover === "white" ? whiteLosses : blackLosses).push(accuracyRes.moves[i]);
			}
		}

		const summarize = (losses: { cpl: number; quality: MoveQuality }[]): AccuracySummary => {
			const counts: Record<MoveQuality, number> = {
				brilliant: 0,
				best: 0,
				good: 0,
				inaccuracy: 0,
				mistake: 0,
				blunder: 0,
			};
			for (const loss of losses) counts[loss.quality]++;
			const cplArr = losses.map((l) => l.cpl);
			const mean = meanCpl(cplArr);
			return {
				accuracy: moveAccuracyPercent(mean),
				meanCpl: mean,
				total: losses.length,
				counts,
			};
		};

		accuracyRes.white = summarize(whiteLosses);
		accuracyRes.black = summarize(blackLosses);

		setRun({
			runFens: uniqueFensRef.current,
			evaluated: uniqueFensRef.current.length,
			result: accuracyRes,
			evaluations: evals,
			result: analyzeAccuracy(evals),
			aborted: false,
		});
	};

	const publishProgress = () => {
		const evals = slotToUniqueRef.current.map(
			(idx) => (idx === null ? null : resultsRef.current[idx] ?? null),
		);
		setRun({
			runFens: uniqueFensRef.current,
			evaluated: resultsRef.current.filter((score) => score !== null).length,
			evaluations: evals,
			result: null,
			aborted: false,
		});
	};

	/** Ends the run without results (engine unusable). */
	const abortAnalysis = () => {
		inflightRef.current = null;
		nextRef.current = uniqueFensRef.current.length;
		setRun((prev) =>
			prev?.runFens === uniqueFensRef.current && prev.aborted ? prev : {
				runFens: uniqueFensRef.current,
				evaluated: resultsRef.current.filter((r) => r !== null).length,
				evaluations: slotToUniqueRef.current.map(
					(idx) => (idx === null ? null : resultsRef.current[idx] ?? null),
				),
				result: null,
				aborted: true,
			},
		);
	};

	// A new move list invalidates all previous bookkeeping. Only refs are
	// touched here; the visible state is derived from `run` vs `uniqueFens`
	// during render (see below).
	useEffect(() => {
		uniqueFensRef.current = uniqueFens;
		slotToUniqueRef.current = slotToUnique;
		resultsRef.current = uniqueFens.map(() => null);
		nextRef.current = 0;
		inflightRef.current = null;

		if (!enabled) return;
		// Stop any search left over from the previous game; the controller
		// discards its output when the stop completes.
		controllerRef.current?.handleRequest({ type: "stop" });
		pump();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [uniqueFens, enabled]);

	// Spawn the engine worker once per enabled session.
	useEffect(() => {
		if (!enabled || typeof Worker === "undefined") return;

		const worker = new Worker(new URL("../workers/stockfishWorker.ts", import.meta.url), {
			type: "module",
		});
		const controller = new EngineController(worker, (message) => {
			worker.postMessage(message);
		});
		controllerRef.current = controller;
		controller.start();

		worker.onmessage = (event: MessageEvent<EngineResponse>) => {
			const message = event.data;
			if (message.type === "ready") {
				readyRef.current = true;
				pump();
			} else if (message.type === "evaluation") {
				const fenIdx = uniqueFensRef.current.indexOf(message.evaluation.fen);
				if (fenIdx === -1) return; // Stale result from a previous game.
				resultsRef.current[fenIdx] = message.evaluation.scoreCp;
				if (message.evaluation.final) {
					if (inflightRef.current === fenIdx) inflightRef.current = null;
					publishProgress();
					pump();
					finishIfComplete();
				}
			} else if (message.type === "error") {
				abortAnalysis();
			}
		};
		worker.onerror = abortAnalysis;

		return () => {
			worker.onmessage = null;
			worker.onerror = null;
			worker.terminate();
			controllerRef.current = null;
			readyRef.current = false;
		};
	}, [enabled]);

	// Derive the visible run state during render (React's recommended
	// alternative to setting state inside effects): a run belongs to the
	// uniqueFens list it was started for, so any other list reads as a fresh
	// run that has not evaluated anything yet.
	const active = enabled && uniqueFens.length > 0;
	const sameRun = run !== null && run.runFens === uniqueFens;
	const progress: AnalysisProgress = !active
		? "idle"
		: sameRun && (run.result || run.aborted)
			? "done"
			: "running";

	return {
		progress,
		evaluated: sameRun ? run.evaluated : 0,
		total: uniqueFens.length,
		evaluations: sameRun ? run.evaluations : evalSlots.map(() => null),
		result: sameRun ? run.result : null,
	};
}
