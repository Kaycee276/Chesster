import {
	DEFAULT_TICK_INTERVAL_MS,
	type TimerWorkerRequest,
	type TimerWorkerResponse,
} from "../workers/timerProtocol";

/**
 * Calls `onTick` once per interval until the returned function is called.
 *
 * Ticks come from a dedicated Web Worker so background-tab throttling cannot
 * stall a countdown. When Workers are unavailable (SSR, older browsers, test
 * environments) or the worker fails to load, it falls back to `setInterval`.
 */
export function startCountdownTicker(
	onTick: () => void,
	intervalMs: number = DEFAULT_TICK_INTERVAL_MS,
): () => void {
	let worker: Worker | null = null;
	let fallbackId: ReturnType<typeof setInterval> | null = null;

	const startFallback = () => {
		if (fallbackId === null) {
			fallbackId = setInterval(onTick, intervalMs);
		}
	};

	if (typeof Worker === "undefined") {
		startFallback();
	} else {
		try {
			const created = new Worker(new URL("../workers/timerWorker.ts", import.meta.url), {
				type: "module",
			});
			worker = created;
			created.onmessage = (event: MessageEvent<TimerWorkerResponse>) => {
				if (event.data?.type === "TICK") onTick();
			};
			created.onerror = () => {
				// The worker could not run; keep the countdown alive on the main thread.
				created.terminate();
				if (worker === created) worker = null;
				startFallback();
			};
			const start: TimerWorkerRequest = { action: "start", intervalMs };
			created.postMessage(start);
		} catch {
			worker = null;
			startFallback();
		}
	}

	return () => {
		if (worker) {
			const stop: TimerWorkerRequest = { action: "stop" };
			worker.postMessage(stop);
			worker.terminate();
			worker = null;
		}
		if (fallbackId !== null) {
			clearInterval(fallbackId);
			fallbackId = null;
		}
	};
}
