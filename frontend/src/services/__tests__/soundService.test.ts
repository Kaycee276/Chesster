import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

interface RecordedOscillator {
	type: string;
	freq: number;
}

// Oscillators created during a single test run, in creation order.
let created: RecordedOscillator[] = [];
let throwOnConstruct = false;

class FakeOscillatorNode {
	type = "sine";
	private record: RecordedOscillator;
	frequency = {
		setValueAtTime: (value: number) => {
			this.record.freq = value;
		},
	};
	constructor(record: RecordedOscillator) {
		this.record = record;
	}
	connect() {}
	start() {}
	stop() {}
}

class FakeGainNode {
	gain = {
		setValueAtTime: () => {},
		linearRampToValueAtTime: () => {},
		exponentialRampToValueAtTime: () => {},
	};
	connect() {}
}

class FakeAudioContext {
	currentTime = 0;
	state: "running" | "suspended" = "running";
	destination = {};

	constructor() {
		if (throwOnConstruct) {
			throw new Error("AudioContext unavailable");
		}
	}

	createOscillator() {
		const record: RecordedOscillator = { type: "sine", freq: 0 };
		const node = new FakeOscillatorNode(record);
		// The service sets node.type after construction; mirror it back so the
		// recorded oscillator reflects the final type at assertion time.
		created.push(record);
		return new Proxy(node, {
			set(target, prop, value) {
				if (prop === "type") record.type = value as string;
				return Reflect.set(target, prop, value);
			},
		});
	}

	createGain() {
		return new FakeGainNode();
	}

	resume() {
		return Promise.resolve();
	}
}

function createMemoryStorage(): Storage {
	const map = new Map<string, string>();
	return {
		getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
		setItem: (k: string, v: string) => {
			map.set(k, String(v));
		},
		removeItem: (k: string) => {
			map.delete(k);
		},
		clear: () => {
			map.clear();
		},
		key: (i: number) => Array.from(map.keys())[i] ?? null,
		get length() {
			return map.size;
		},
	} as Storage;
}

async function loadService() {
	vi.resetModules();
	const mod = await import("../soundService");
	return mod.soundService;
}

beforeEach(() => {
	created = [];
	throwOnConstruct = false;
	vi.stubGlobal("localStorage", createMemoryStorage());
	vi.stubGlobal("AudioContext", FakeAudioContext as unknown as typeof AudioContext);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("soundService", () => {
	describe("frequency synthesis", () => {
		it("plays a single square tone at 520Hz on move()", async () => {
			const soundService = await loadService();
			soundService.move();
			expect(created).toHaveLength(1);
			expect(created[0].freq).toBe(520);
			expect(created[0].type).toBe("square");
		});

		it("plays a descending two-tone sawtooth on capture()", async () => {
			const soundService = await loadService();
			soundService.capture();
			expect(created.map((o) => o.freq)).toEqual([300, 220]);
			expect(created.every((o) => o.type === "sawtooth")).toBe(true);
		});

		it("plays a repeated 880Hz alert on check()", async () => {
			const soundService = await loadService();
			soundService.check();
			expect(created.map((o) => o.freq)).toEqual([880, 880]);
		});

		it("plays a four-note rising arpeggio on promote()", async () => {
			const soundService = await loadService();
			soundService.promote();
			expect(created.map((o) => o.freq)).toEqual([440, 550, 660, 880]);
		});
	});

	describe("enable / disable state", () => {
		it("produces no audio while disabled", async () => {
			const soundService = await loadService();
			soundService.setEnabled(false);
			soundService.move();
			expect(created).toHaveLength(0);
			expect(soundService.isEnabled()).toBe(false);
		});

		it("toggle() flips and reports the new state", async () => {
			const soundService = await loadService();
			const first = soundService.toggle();
			expect(first).toBe(false);
			const second = soundService.toggle();
			expect(second).toBe(true);
		});

		it("clamps volume into the 0..1 range", async () => {
			const soundService = await loadService();
			soundService.setVolume(5);
			expect(soundService.getVolume()).toBe(1);
			soundService.setVolume(-2);
			expect(soundService.getVolume()).toBe(0);
		});
	});

	describe("error handling", () => {
		it("does not throw when AudioContext construction fails", async () => {
			const soundService = await loadService();
			throwOnConstruct = true;
			expect(() => soundService.move()).not.toThrow();
			expect(created).toHaveLength(0);
		});
	});
});
