/**
 * 500-client WebSocket room subscription stress test.
 *
 * Spawns spectators (spread across worker threads so client-side message
 * handling does not distort server measurements) that all subscribe to one
 * match room, streams moves from White and Black, and reports P50/P90/P99
 * broadcast latency, server event loop lag, and socket cleanup after
 * disconnection.
 *
 * By default an embedded Socket.IO server with the same room fan-out pattern
 * is started so the test is self-contained. Set LOAD_SERVER_URL to target an
 * external server instead (server-side leak checks are skipped in that mode).
 *
 * Env: LOAD_CLIENTS (500), LOAD_MOVES (60), LOAD_MOVE_INTERVAL_MS (200),
 *      LOAD_RAMP_PER_SEC (50), LOAD_WORKERS (8), LOAD_ROOM (game:load-test-001),
 *      LOAD_P99_BUDGET_MS (50), LOAD_LAG_BUDGET_MS (20).
 */
const http = require("node:http");
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");
const { monitorEventLoopDelay } = require("node:perf_hooks");
const { Server } = require("socket.io");
const { io: connect } = require("socket.io-client");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function percentile(sortedValues, fraction) {
	if (sortedValues.length === 0) return 0;
	const rank = Math.ceil(sortedValues.length * fraction) - 1;
	return sortedValues[Math.min(sortedValues.length - 1, Math.max(0, rank))];
}

function summarize(latencies) {
	const sorted = latencies.slice().sort((a, b) => a - b);
	return {
		count: sorted.length,
		p50: percentile(sorted, 0.5),
		p90: percentile(sorted, 0.9),
		p99: percentile(sorted, 0.99),
		max: sorted.length ? sorted[sorted.length - 1] : 0,
	};
}

function startEmbeddedServer() {
	const httpServer = http.createServer();
	const io = new Server(httpServer, {
		transports: ["websocket"],
		serveClient: false,
		perMessageDeflate: false,
		httpCompression: false,
	});
	io.on("connection", (socket) => {
		socket.on("join_room", ({ gameId } = {}, ack) => {
			if (typeof gameId !== "string" || !gameId) return;
			socket.join(gameId);
			if (typeof ack === "function") ack({ ok: true });
		});
		socket.on("make_move", ({ gameId, ...move } = {}) => {
			io.to(gameId).emit("move_made", { ...move, sentAt: Date.now() });
		});
	});
	return new Promise((resolve) => {
		httpServer.listen(0, "127.0.0.1", () => {
			resolve({ io, httpServer, url: `http://127.0.0.1:${httpServer.address().port}` });
		});
	});
}

function openClient(url) {
	return new Promise((resolve, reject) => {
		const socket = connect(url, {
			transports: ["websocket"],
			forceNew: true,
			reconnection: false,
		});
		socket.once("connect", () => resolve(socket));
		socket.once("connect_error", reject);
	});
}

/** Worker thread body: owns a share of the spectators. */
async function spectatorWorker({ url, count, rampPerSecond, room }) {
	const sockets = [];
	const latencies = [];
	const errors = [];
	for (let i = 0; i < count; i += rampPerSecond) {
		const batchSize = Math.min(rampPerSecond, count - i);
		const started = Date.now();
		const batch = await Promise.all(
			Array.from({ length: batchSize }, async () => {
				const socket = await openClient(url);
				socket.on("move_made", (data) => {
					if (!data?.warmup) latencies.push(Date.now() - data.sentAt);
				});
				socket.on("error", (err) => errors.push(String(err)));
				await new Promise((resolve) => socket.emit("join_room", { gameId: room }, resolve));
				return socket;
			}),
		);
		sockets.push(...batch);
		if (i + batchSize < count) await sleep(Math.max(0, 1000 - (Date.now() - started)));
	}
	parentPort.postMessage({ type: "ready" });
	await new Promise((resolve) => parentPort.once("message", resolve));
	sockets.forEach((s) => s.disconnect());
	parentPort.postMessage({ type: "result", latencies, errors });
}

function spawnWorker(config) {
	const worker = new Worker(__filename, { workerData: config });
	const ready = new Promise((resolve, reject) => {
		worker.on("message", (m) => m.type === "ready" && resolve());
		worker.once("error", reject);
	});
	const result = new Promise((resolve, reject) => {
		worker.on("message", (m) => m.type === "result" && resolve(m));
		worker.once("error", reject);
	});
	return { worker, ready, result };
}

async function measureLoopLag(work) {
	const histogram = monitorEventLoopDelay({ resolution: 10 });
	histogram.enable();
	try {
		await work();
	} finally {
		histogram.disable();
	}
	return {
		meanMs: histogram.mean / 1e6,
		p95Ms: histogram.percentile(95) / 1e6,
		p99Ms: histogram.percentile(99) / 1e6,
		maxMs: histogram.max / 1e6,
	};
}

async function runSpectatorLoadTest(options = {}) {
	const {
		serverUrl = process.env.LOAD_SERVER_URL || null,
		numClients = Number(process.env.LOAD_CLIENTS || 500),
		moves = Number(process.env.LOAD_MOVES || 60),
		moveIntervalMs = Number(process.env.LOAD_MOVE_INTERVAL_MS || 200),
		rampPerSecond = Number(process.env.LOAD_RAMP_PER_SEC || 50),
		numWorkers = Number(process.env.LOAD_WORKERS || 6),
		room = process.env.LOAD_ROOM || "game:load-test-001",
		p99BudgetMs = Number(process.env.LOAD_P99_BUDGET_MS || 50),
		lagBudgetMs = Number(process.env.LOAD_LAG_BUDGET_MS || 20),
	} = options;

	const embedded = serverUrl ? null : await startEmbeddedServer();
	const url = serverUrl || embedded.url;
	const workerCount = Math.max(1, Math.min(numWorkers, numClients));
	const pool = [];
	let players = [];

	try {
		// Each worker ramps its share so the total is ~rampPerSecond conn/sec.
		const perWorkerRamp = Math.max(1, Math.floor(rampPerSecond / workerCount));
		for (let w = 0; w < workerCount; w++) {
			const count = Math.floor(numClients / workerCount) + (w < numClients % workerCount ? 1 : 0);
			pool.push(spawnWorker({ url, count, rampPerSecond: perWorkerRamp, room }));
		}
		await Promise.all(pool.map((p) => p.ready));

		players = await Promise.all([openClient(url), openClient(url)]);
		await Promise.all(players.map((p) => new Promise((resolve) => p.emit("join_room", { gameId: room }, resolve))));

		// Measure idle baseline event loop lag to account for OS timer granularity (e.g. Windows ~15.6ms ticks)
		const idleLag = await measureLoopLag(() => sleep(300));

		// Warm-up pass (not recorded in metrics) so V8 JIT compiles broadcast paths
		players[0].emit("make_move", {
			gameId: room,
			moveNumber: 0,
			color: "white",
			sentAt: Date.now(),
			warmup: true,
		});
		await sleep(150);

		const loadedLag = await measureLoopLag(async () => {
			for (let n = 0; n < moves; n++) {
				players[n % 2].emit("make_move", {
					gameId: room,
					moveNumber: n + 1,
					color: n % 2 ? "black" : "white",
					sentAt: Date.now(),
				});
				await sleep(moveIntervalMs);
			}
			await sleep(250);
		});

		pool.forEach((p) => p.worker.postMessage("finish"));
		const results = await Promise.all(pool.map((p) => p.result));
		const latencies = results.flatMap((r) => r.latencies);
		const errors = results.flatMap((r) => r.errors);
		players.forEach((p) => p.disconnect());

		const expected = moves * numClients;
		const stats = summarize(latencies);
		const eventLoopLagMs = Math.max(0, loadedLag.meanMs - idleLag.meanMs);

		let leaked = null;
		if (embedded) {
			for (let i = 0; i < 60 && embedded.io.sockets.sockets.size > 0; i++) await sleep(50);
			leaked = {
				sockets: embedded.io.sockets.sockets.size,
				roomMembers: embedded.io.sockets.adapter.rooms.get(room)?.size || 0,
			};
		}

		const report = {
			clients: numClients,
			workers: workerCount,
			moves,
			expectedMessages: expected,
			receivedMessages: stats.count,
			latencyMs: { p50: stats.p50, p90: stats.p90, p99: stats.p99, max: stats.max },
			eventLoopLagMs: Number(eventLoopLagMs.toFixed(2)),
			eventLoopLagRawP99Ms: Number(loadedLag.p99Ms.toFixed(2)),
			leaked,
			errors: errors.length,
		};
		const failures = [];
		if (stats.count !== expected) failures.push(`expected ${expected} messages, received ${stats.count}`);
		if (stats.p99 >= p99BudgetMs) failures.push(`P99 ${stats.p99}ms exceeds ${p99BudgetMs}ms`);
		if (eventLoopLagMs >= lagBudgetMs) failures.push(`event loop lag ${eventLoopLagMs.toFixed(2)}ms exceeds ${lagBudgetMs}ms`);
		if (leaked && (leaked.sockets > 0 || leaked.roomMembers > 0)) failures.push("sockets leaked after disconnect");
		if (errors.length) failures.push(`${errors.length} socket errors`);
		return { report, failures, passed: failures.length === 0 };
	} finally {
		players.forEach((p) => p.disconnect());
		await Promise.all(pool.map((p) => p.worker.terminate()));
		if (embedded) {
			await new Promise((resolve) => embedded.io.close(() => resolve()));
		}
	}
}

if (!isMainThread && workerData && workerData.url) {
	spectatorWorker(workerData).catch((error) => {
		console.error(error);
		process.exit(1);
	});
} else if (require.main === module) {
	runSpectatorLoadTest()
		.then(({ report, failures, passed }) => {
			console.log(JSON.stringify(report, null, 2));
			if (!passed) {
				console.error(`FAILED: ${failures.join("; ")}`);
				process.exitCode = 1;
			}
		})
		.catch((error) => {
			console.error(error);
			process.exitCode = 1;
		});
}

module.exports = { runSpectatorLoadTest, percentile, summarize };
