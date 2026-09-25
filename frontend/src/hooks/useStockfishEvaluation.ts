import { useEffect, useRef, useState } from "react";
import type { EngineEvaluation } from "../utils/engineEvaluation";
import {
	DEFAULT_SEARCH_DEPTH,
	type EngineRequest,
	type EngineResponse,
} from "../workers/engineController";

export type EngineStatus = "loading" | "ready" | "error" | "unsupported";

interface Options {
	depth?: number;
	enabled?: boolean;
}

interface State {
	status: EngineStatus;
	evaluation: EngineEvaluation | null;
}

function isTabHidden(): boolean {
	return typeof document !== "undefined" && document.visibilityState === "hidden";
}

/**
 * Evaluates `fen` with client-side Stockfish running in a Web Worker.
 *
 * - The previous evaluation stays visible until the new position produces its
 *   first result, so the bar animates between positions instead of resetting.
 * - Searching pauses while the tab is hidden (to save battery) and resumes when
 *   it becomes visible again, unless that position was already fully evaluated.
 * - The worker (and the engine it hosts) is terminated on unmount.
 */
export function useStockfishEvaluation(
	fen: string | null,
	{ depth = DEFAULT_SEARCH_DEPTH, enabled = true }: Options = {},
) {
	const [state, setState] = useState<State>(() => ({
		status: typeof Worker === "undefined" ? "unsupported" : "loading",
		evaluation: null,
	}));
	const workerRef = useRef<Worker | null>(null);
	const fenRef = useRef(fen);
	const depthRef = useRef(depth);
	const completedFenRef = useRef<string | null>(null);

	// Spawn the worker once per enabled session.
	useEffect(() => {
		if (!enabled || typeof Worker === "undefined") return;

		const worker = new Worker(new URL("../workers/stockfishWorker.ts", import.meta.url), {
			type: "module",
		});
		workerRef.current = worker;

		worker.onmessage = (event: MessageEvent<EngineResponse>) => {
			const message = event.data;
			if (message.type === "ready") {
				setState((prev) => ({ ...prev, status: "ready" }));
			} else if (message.type === "evaluation") {
				// Ignore late results for positions that are no longer displayed.
				if (message.evaluation.fen !== fenRef.current) return;
				if (message.evaluation.final) completedFenRef.current = message.evaluation.fen;
				setState({ status: "ready", evaluation: message.evaluation });
			} else if (message.type === "error") {
				setState((prev) => ({ ...prev, status: "error" }));
			}
		};
		worker.onerror = () => setState((prev) => ({ ...prev, status: "error" }));

		return () => {
			worker.terminate();
			workerRef.current = null;
			completedFenRef.current = null;
		};
	}, [enabled]);

	// Request an evaluation whenever the position changes.
	useEffect(() => {
		fenRef.current = fen;
		depthRef.current = depth;

		const worker = workerRef.current;
		if (!worker) return;

		const request: EngineRequest =
			fen && !isTabHidden() ? { type: "evaluate", fen, depth } : { type: "stop" };
		worker.postMessage(request);
	}, [fen, depth, enabled]);

	// Pause while the tab is hidden; resume when it is visible again.
	useEffect(() => {
		if (typeof document === "undefined") return;

		const handleVisibilityChange = () => {
			const worker = workerRef.current;
			if (!worker) return;

			if (isTabHidden()) {
				worker.postMessage({ type: "stop" } satisfies EngineRequest);
				return;
			}

			const currentFen = fenRef.current;
			if (currentFen && completedFenRef.current !== currentFen) {
				worker.postMessage({
					type: "evaluate",
					fen: currentFen,
					depth: depthRef.current,
				} satisfies EngineRequest);
			}
		};

		document.addEventListener("visibilitychange", handleVisibilityChange);
		return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
	}, []);

	return state;
}
