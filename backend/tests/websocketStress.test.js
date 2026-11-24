const { runSpectatorLoadTest, percentile, summarize } = require("./load/websocketStress");

describe("websocket stress helpers", () => {
	test("percentile uses nearest-rank on sorted values", () => {
		const values = Array.from({ length: 100 }, (_, i) => i + 1);
		expect(percentile(values, 0.5)).toBe(50);
		expect(percentile(values, 0.9)).toBe(90);
		expect(percentile(values, 0.99)).toBe(99);
	});

	test("percentile handles empty and single-value input", () => {
		expect(percentile([], 0.99)).toBe(0);
		expect(percentile([7], 0.99)).toBe(7);
	});

	test("summarize sorts unsorted latencies", () => {
		expect(summarize([5, 1, 3])).toMatchObject({ count: 3, p50: 3, max: 5 });
	});
});

describe("websocket stress harness", () => {
	test("small run delivers every move to every client and cleans up", async () => {
		const { report, passed, failures } = await runSpectatorLoadTest({
			numClients: 20,
			moves: 5,
			moveIntervalMs: 20,
			rampPerSecond: 20,
			p99BudgetMs: 1000,
			lagBudgetMs: 1000,
		});
		expect(failures).toEqual([]);
		expect(passed).toBe(true);
		expect(report.receivedMessages).toBe(5 * 20);
		expect(report.leaked).toEqual({ sockets: 0, roomMembers: 0 });
	}, 20000);
});
