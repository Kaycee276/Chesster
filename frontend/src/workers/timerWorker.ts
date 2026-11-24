/**
 * Countdown tick Web Worker.
 *
 * Browsers throttle main-thread timers in background tabs (often to once a
 * minute), which makes round countdowns drift while a player is multitasking.
 * This worker owns the interval instead and posts a TICK message on each beat,
 * so the countdown keeps ticking while the tab is hidden.
 *
 * Protocol (see TimerWorkerRequest / TimerWorkerResponse):
 *   start -> begin posting TICK every `intervalMs` (default 1000)
 *   stop  -> cancel the interval; the worker stays alive for reuse
 */

import {
	DEFAULT_TICK_INTERVAL_MS,
	type TimerWorkerRequest,
	type TimerWorkerResponse,
} from "./timerProtocol";

// Typed view of the dedicated worker scope (the app is compiled with DOM libs).
const scope = self as unknown as {
	postMessage(message: TimerWorkerResponse): void;
	onmessage: ((event: MessageEvent<TimerWorkerRequest>) => void) | null;
};

let intervalId: ReturnType<typeof setInterval> | null = null;

function stopTicking(): void {
	if (intervalId !== null) {
		clearInterval(intervalId);
		intervalId = null;
	}
}

scope.onmessage = (event: MessageEvent<TimerWorkerRequest>) => {
	const message = event.data;
	if (message?.action === "start") {
		stopTicking();
		const requested = message.intervalMs;
		const intervalMs =
			typeof requested === "number" && requested > 0 ? requested : DEFAULT_TICK_INTERVAL_MS;
		intervalId = setInterval(() => {
			scope.postMessage({ type: "TICK" });
		}, intervalMs);
	} else if (message?.action === "stop") {
		stopTicking();
	}
};
