// Scriptable worker for BotWorkerPool tests. Speaks the same message
// protocol as workers/stockfishWorker.js; behaviour is picked per task via
// payload.mode.
const { parentPort, threadId } = require("worker_threads");
const { spawn } = require("child_process");

function busyWait(ms) {
	const end = Date.now() + ms;
	while (Date.now() < end) { /* burn CPU like an engine search */ }
}

parentPort.on("message", ({ type, id, payload }) => {
	if (type !== "task") return;
	const reply = (result) => parentPort.postMessage({ type: "result", id, result: { threadId, ...result } });

	switch (payload.mode) {
		case "spin":
			busyWait(payload.ms);
			return reply({ label: payload.label });
		case "hang": {
			// Simulate a stuck engine: report a live child process, never answer.
			const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
			parentPort.postMessage({ type: "engine-pid", pid: child.pid });
			return;
		}
		case "crash":
			return process.exit(3);
		case "error":
			return parentPort.postMessage({ type: "result", id, error: { message: "engine blew up", code: "ENGINE_FAIL" } });
		default:
			return reply({ label: payload.label, deadline: payload.deadline });
	}
});
