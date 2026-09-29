import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	render,
	screen,
	cleanup,
	fireEvent,
	waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AnalysisPage from "./AnalysisPage";
import { useToastStore } from "../store/toastStore";

// The accuracy hook spawns a Stockfish worker; stub it so the page renders
// in jsdom without one.
vi.mock("../hooks/useMoveAccuracyAnalysis", () => ({
	ANALYSIS_SEARCH_DEPTH: 10,
	useMoveAccuracyAnalysis: () => ({
		progress: "idle",
		evaluated: 0,
		total: 0,
		result: null,
	}),
}));

const SINGLE_GAME = `[Event "Test Match"]
[White "Alice"]
[Black "Bob"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O 1-0`;

const COLLECTION = `${SINGLE_GAME}

[Event "Second Game"]
[White "Carla"]
[Black "Dave"]
[Result "0-1"]

1. d4 d5 2. c4 e6 0-1`;

/** Renders AnalysisPage with the router context it needs. */
function renderPage() {
	return render(
		<MemoryRouter>
			<AnalysisPage />
		</MemoryRouter>,
	);
}

/** Creates a File and dispatches a drop event carrying it. */
function dropFile(file: File) {
	fireEvent.drop(window, {
		dataTransfer: {
			files: [file],
			types: ["Files"],
		},
	});
}

function makePgnFile(content: string, name = "games.pgn") {
	return new File([content], name, { type: "text/plain" });
}

beforeEach(() => {
	useToastStore.setState({ toasts: [] });
});

afterEach(() => {
	cleanup();
});

describe("AnalysisPage PGN drag-and-drop (#318)", () => {
	it("loads a dropped single-game PGN instantly", async () => {
		renderPage();

		dropFile(makePgnFile(SINGLE_GAME));

		// Moves land in the analysis tree.
		await waitFor(() =>
			expect(screen.getByText("e4")).toBeInTheDocument(),
		);
		// Header info is shown.
		await waitFor(() =>
			expect(screen.getByText(/Alice vs Bob/)).toBeInTheDocument(),
		);
		// Success toast confirms the import.
		expect(
			useToastStore.getState().toasts.some((t) => t.type === "success"),
		).toBe(true);
		// No selector is shown for single-game files.
		expect(
			screen.queryByLabelText(/select game from pgn file/i),
		).not.toBeInTheDocument();
	});

	it("shows the game selector for a multi-game collection and switches games", async () => {
		renderPage();

		dropFile(makePgnFile(COLLECTION));

		const selector = await screen.findByLabelText(
			/select game from pgn file/i,
		);
		// The first game is loaded right away. Match the header span (which
		// includes the result) rather than the selector option labels.
		expect(screen.getByText(/Alice vs Bob · 1-0/)).toBeInTheDocument();

		// Switch to the second game via the dropdown.
		fireEvent.change(selector, { target: { value: "1" } });
		await waitFor(() =>
			expect(screen.getByText(/Carla vs Dave · 0-1/)).toBeInTheDocument(),
		);
	});

	it("shows an error toast for a corrupt PGN file", async () => {
		renderPage();

		dropFile(makePgnFile("1. e4 e5 2. Bc4 3. nonsense", "broken.pgn"));

		await waitFor(() =>
			expect(
				useToastStore.getState().toasts.some((t) => t.type === "error"),
			).toBe(true),
		);
	});

	it("shows an error toast for an unreadable file", async () => {
		renderPage();

		const file = makePgnFile(SINGLE_GAME);
		// Simulate a FileReader failure.
		vi.spyOn(FileReader.prototype, "readAsText").mockImplementation(
			function (this: FileReader) {
				// Dispatching the DOM error event invokes the onerror handler.
				this.dispatchEvent(new Event("error"));
			},
		);

		dropFile(file);

		await waitFor(() =>
			expect(
				useToastStore
					.getState()
					.toasts.some((t) => /could not read/i.test(t.message)),
			).toBe(true),
		);
		vi.restoreAllMocks();
	});
});
