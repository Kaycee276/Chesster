// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { MatchReadyEvent } from "../../src/api/socket";

vi.mock("../../src/services/soundService", () => ({
	soundService: {
		playAlert: vi.fn(),
	},
}));

import { TournamentQueueModal } from "../../src/components/TournamentQueueModal";

// React 19 wants this flag whenever act() is used outside its own test renderer.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Minimal stand-in for the browser Worker so the test can drive TICK messages. */
class FakeWorker {
	static instances: FakeWorker[] = [];
	onmessage: ((event: MessageEvent) => void) | null = null;
	onerror: ((event: Event) => void) | null = null;
	postMessage = vi.fn();
	terminate = vi.fn(() => {
		this.terminated = true;
	});
	terminated = false;

	constructor(
		public url: URL,
		public options?: WorkerOptions,
	) {
		FakeWorker.instances.push(this);
	}

	emitTick() {
		if (this.terminated) return;
		this.onmessage?.({ data: { type: "TICK" } } as MessageEvent);
	}
}

const matchData: MatchReadyEvent = {
	gameCode: "game-42",
	round: 2,
	opponentName: "Rival",
	opponentRating: 1600,
	color: "white",
};

describe("TournamentQueueModal countdown (dedicated timer worker)", () => {
	let container: HTMLElement;
	let reactRoot: Root;

	beforeEach(() => {
		FakeWorker.instances = [];
		vi.stubGlobal("Worker", FakeWorker);
		container = document.createElement("div");
		document.body.appendChild(container);
		reactRoot = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			reactRoot.unmount();
		});
		container.remove();
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	const renderModal = (props: { matchData?: MatchReadyEvent; onEnterMatch?: (code: string) => void }) => {
		act(() => {
			reactRoot.render(createElement(TournamentQueueModal, props));
		});
	};

	const joinButtonText = () => container.querySelector("button")?.textContent ?? "";

	it("starts one worker with a 1-second interval and counts down on each TICK", () => {
		renderModal({ matchData, onEnterMatch: vi.fn() });

		expect(FakeWorker.instances).toHaveLength(1);
		const worker = FakeWorker.instances[0];
		expect(worker.postMessage).toHaveBeenCalledWith({ action: "start", intervalMs: 1000 });
		expect(joinButtonText()).toContain("60s");

		act(() => worker.emitTick());
		expect(joinButtonText()).toContain("59s");

		act(() => worker.emitTick());
		expect(joinButtonText()).toContain("58s");
	});

	it("enters the match once when the countdown reaches zero, then stops the worker", () => {
		const onEnterMatch = vi.fn();
		renderModal({ matchData, onEnterMatch });
		const worker = FakeWorker.instances[0];

		act(() => {
			for (let i = 0; i < 60; i += 1) worker.emitTick();
		});

		expect(onEnterMatch).toHaveBeenCalledTimes(1);
		expect(onEnterMatch).toHaveBeenCalledWith("game-42");
		expect(worker.postMessage).toHaveBeenLastCalledWith({ action: "stop" });
		expect(worker.terminate).toHaveBeenCalled();

		// Late ticks after expiry must not re-enter the match.
		act(() => worker.emitTick());
		expect(onEnterMatch).toHaveBeenCalledTimes(1);
	});

	it("terminates the worker when the modal closes (match cleared)", () => {
		renderModal({ matchData, onEnterMatch: vi.fn() });
		const worker = FakeWorker.instances[0];
		expect(worker.terminated).toBe(false);

		renderModal({ onEnterMatch: vi.fn() });

		expect(worker.terminate).toHaveBeenCalled();
		expect(worker.terminated).toBe(true);
	});

	it("starts a fresh countdown for a new match and terminates the previous worker", () => {
		renderModal({ matchData, onEnterMatch: vi.fn() });
		const first = FakeWorker.instances[0];
		act(() => first.emitTick());
		expect(joinButtonText()).toContain("59s");

		renderModal({ matchData: { ...matchData, gameCode: "game-43" }, onEnterMatch: vi.fn() });

		expect(first.terminate).toHaveBeenCalled();
		expect(FakeWorker.instances).toHaveLength(2);
		expect(joinButtonText()).toContain("60s");
	});

	it("does not start a countdown when no enter handler is provided", () => {
		renderModal({ matchData });
		expect(FakeWorker.instances).toHaveLength(0);
		expect(joinButtonText()).toContain("60s");
	});

	it("falls back to main-thread timers when Workers are unavailable", () => {
		vi.useFakeTimers();
		vi.stubGlobal("Worker", undefined);
		const onEnterMatch = vi.fn();

		renderModal({ matchData, onEnterMatch });
		act(() => {
			vi.advanceTimersByTime(3000);
		});

		expect(FakeWorker.instances).toHaveLength(0);
		expect(joinButtonText()).toContain("57s");

		act(() => {
			vi.advanceTimersByTime(57_000);
		});
		expect(onEnterMatch).toHaveBeenCalledTimes(1);
		expect(onEnterMatch).toHaveBeenCalledWith("game-42");
	});
});
