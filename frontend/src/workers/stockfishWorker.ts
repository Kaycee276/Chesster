/**
 * Stockfish evaluation Web Worker.
 *
 * Runs the UCI protocol handling off the UI thread and hosts the Stockfish
 * WASM engine (lite, single-threaded build vendored in public/stockfish) as a
 * nested worker, so neither parsing nor searching can block React rendering.
 *
 * Protocol: see EngineRequest / EngineResponse in ./engineController.
 */
import { EngineController, type EngineRequest, type EngineResponse } from "./engineController";

const ENGINE_URL = `${import.meta.env.BASE_URL}stockfish/stockfish-19-lite-single.js`;

// Typed view of the dedicated worker scope (the app is compiled with DOM libs).
const scope = self as unknown as {
	postMessage(message: EngineResponse): void;
	onmessage: ((event: MessageEvent<EngineRequest>) => void) | null;
};

const engine = new Worker(new URL(ENGINE_URL, self.location.origin));

const controller = new EngineController(engine, (message) => scope.postMessage(message));

engine.onmessage = (event: MessageEvent<unknown>) => {
	if (typeof event.data === "string") controller.handleEngineOutput(event.data);
};

engine.onerror = (event: ErrorEvent) => {
	event.preventDefault();
	scope.postMessage({ type: "error", message: event.message || "Stockfish engine failed to load" });
};

scope.onmessage = (event) => controller.handleRequest(event.data);

controller.start();
