/** Socket.IO load simulation for issue #331. */
const { performance } = require("node:perf_hooks");
const { io } = require("socket.io-client");

const BASE_URL = process.env.LOAD_BASE_URL || "http://localhost:3001";
const ROOMS = Number(process.env.LOAD_ROOMS || 100);
const MOVES = Number(process.env.LOAD_MOVES || 30);
const DURATION_SECONDS = Number(process.env.LOAD_DURATION_SECONDS || 10);
const MOVE_INTERVAL_MS = Number(process.env.LOAD_MOVE_INTERVAL_MS || 1000);
const positions = [[[6, 4], [4, 4]], [[1, 4], [3, 4]], [[7, 6], [5, 5]], [[0, 1], [2, 2]]];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connectClient(room, playerColor, metrics) {
  const socket = io(BASE_URL, { transports: ["websocket"], reconnection: false, autoConnect: false });
  const started = performance.now();
  socket.on("connect_error", (error) => metrics.errors.push(error));
  socket.on("disconnect", (reason) => { if (reason !== "io client disconnect") metrics.unexpectedDisconnects += 1; });
  socket.on("game-update", () => metrics.latencies.push(performance.now() - started));
  socket.on("move-rejected", () => { metrics.rejectedMoves += 1; });
  await new Promise((resolve, reject) => { socket.once("connect", resolve); socket.once("connect_error", reject); socket.connect(); });
  socket.emit("join-game", { gameCode: room, playerColor });
  return socket;
}

async function main() {
  const metrics = { latencies: [], errors: [], unexpectedDisconnects: 0, rejectedMoves: 0 };
  const sockets = [];
  for (let roomIndex = 0; roomIndex < ROOMS; roomIndex += 1) {
    const room = `load-${process.pid}-${roomIndex}`;
    sockets.push(await connectClient(room, "white", metrics));
    sockets.push(await connectClient(room, "black", metrics));
  }
  const deadline = Date.now() + DURATION_SECONDS * 1000;
  for (let move = 0; move < MOVES && Date.now() < deadline; move += 1) {
    const [from, to] = positions[move % positions.length];
    sockets.forEach((socket, index) => socket.emit("make-move", { gameCode: `load-${process.pid}-${Math.floor(index / 2)}`, from, to }));
    await sleep(MOVE_INTERVAL_MS);
  }
  sockets.forEach((socket) => socket.disconnect());
  const values = metrics.latencies.slice().sort((a, b) => a - b);
  const percentile = (fraction) => values.length === 0 ? 0 : values[Math.min(values.length - 1, Math.floor(values.length * fraction))];
  const report = { rooms: ROOMS, clients: sockets.length, updates: values.length, p95Ms: Number(percentile(0.95).toFixed(2)), p99Ms: Number(percentile(0.99).toFixed(2)), rejectedMoves: metrics.rejectedMoves, unexpectedDisconnects: metrics.unexpectedDisconnects, connectionErrors: metrics.errors.length };
  console.log(JSON.stringify(report, null, 2));
  if (metrics.errors.length || metrics.unexpectedDisconnects) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
