/**
 * Message protocol shared by the countdown tick worker and its main-thread client.
 *
 * Kept free of side effects so the main thread can import it without loading
 * the worker's message handler.
 */

export type TimerWorkerRequest =
	| { action: "start"; intervalMs?: number }
	| { action: "stop" };

export type TimerWorkerResponse = { type: "TICK" };

export const DEFAULT_TICK_INTERVAL_MS = 1000;
