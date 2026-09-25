// Minimal UCI engine used by the bot worker tests in place of a real
// Stockfish binary. Usage: node fakeUciEngine.js <mode> [commandLogFile]
//   mode "ok"   -> answers every `go` with `bestmove e2e4`
//   mode "none" -> answers every `go` with `bestmove (none)` (no legal moves)
//   mode "hang" -> never answers `go` (simulates a stuck search)
const fs = require("fs");
const readline = require("readline");

const [mode = "ok", logFile] = process.argv.slice(2);
const out = (line) => process.stdout.write(`${line}\n`);

readline.createInterface({ input: process.stdin }).on("line", (line) => {
	if (logFile) fs.appendFileSync(logFile, `${line}\n`);

	if (line === "uci") {
		out("id name FakeFish");
		out("uciok");
	} else if (line === "isready") {
		out("readyok");
	} else if (line.startsWith("go")) {
		if (mode === "hang") return;
		out("info depth 1 score cp 20 pv e2e4");
		out(mode === "none" ? "bestmove (none)" : "bestmove e2e4 ponder e7e5");
	} else if (line === "quit") {
		process.exit(0);
	}
});
