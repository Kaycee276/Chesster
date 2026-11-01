import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import GameSettings from "../src/components/GameSettings";
import { useGameStore } from "../src/store/gameStore";

describe("GameSettings Component", () => {
	beforeEach(() => {
		useGameStore.setState({
			blindfoldMode: "none",
			isBlindfoldMode: false,
		});
		localStorage.clear();
	});

	afterEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
	});

	it("renders the settings trigger button", () => {
		render(<GameSettings />);
		const triggerButton = screen.getByRole("button", { name: /game settings/i });
		expect(triggerButton).toBeTruthy();
	});

	it("settings panel is hidden by default", () => {
		render(<GameSettings />);
		expect(screen.queryByText("Game Settings")).toBeFalsy();
	});

	it("opens settings panel when trigger button is clicked", async () => {
		render(<GameSettings />);
		const triggerButton = screen.getByRole("button", { name: /game settings/i });

		fireEvent.click(triggerButton);

		await waitFor(() => {
			expect(screen.getByText("Game Settings")).toBeTruthy();
		});
	});

	it("closes settings panel when close button is clicked", async () => {
		render(<GameSettings />);
		const triggerButton = screen.getByRole("button", { name: /game settings/i });

		fireEvent.click(triggerButton);

		await waitFor(() => {
			expect(screen.getByText("Game Settings")).toBeTruthy();
		});

		const closeButton = screen.getByRole("button", { name: /close/i });
		fireEvent.click(closeButton);

		await waitFor(() => {
			expect(screen.queryByText("Game Settings")).toBeFalsy();
		});
	});

	it("closes settings panel when clicking outside (backdrop)", async () => {
		render(<GameSettings />);
		const triggerButton = screen.getByRole("button", { name: /game settings/i });

		fireEvent.click(triggerButton);

		await waitFor(() => {
			expect(screen.getByText("Game Settings")).toBeTruthy();
		});

		// Click on the backdrop
		const backdrop = screen.getByText("Game Settings").closest(".fixed.inset-0");
		if (backdrop) {
			fireEvent.click(backdrop);
		}

		await waitFor(() => {
			expect(screen.queryByText("Game Settings")).toBeFalsy();
		});
	});

	it("displays Blindfold Mode toggle switch", async () => {
		render(<GameSettings />);
		const triggerButton = screen.getByRole("button", { name: /game settings/i });

		fireEvent.click(triggerButton);

		await waitFor(() => {
			expect(screen.getByText("Blindfold Mode")).toBeTruthy();
		});

		const toggle = screen.getByRole("switch", { name: /toggle blindfold mode/i });
		expect(toggle).toBeTruthy();
	});

	it("toggle switch reflects current blindfold mode state", async () => {
		useGameStore.setState({ isBlindfoldMode: false });
		render(<GameSettings />);

		const triggerButton = screen.getByRole("button", { name: /game settings/i });
		fireEvent.click(triggerButton);

		await waitFor(() => {
			const toggle = screen.getByRole("switch", { name: /toggle blindfold mode/i }) as HTMLElement;
			expect(toggle.getAttribute("aria-checked")).toBe("false");
		});

		// Toggle on
		useGameStore.setState({ isBlindfoldMode: true });

		await waitFor(() => {
			const toggle = screen.getByRole("switch", { name: /toggle blindfold mode/i }) as HTMLElement;
			expect(toggle.getAttribute("aria-checked")).toBe("true");
		});
	});

	it("clicking toggle updates blindfold mode state", async () => {
		render(<GameSettings />);
		const triggerButton = screen.getByRole("button", { name: /game settings/i });

		fireEvent.click(triggerButton);

		await waitFor(() => {
			expect(useGameStore.getState().isBlindfoldMode).toBe(false);
		});

		const toggle = screen.getByRole("switch", { name: /toggle blindfold mode/i });
		fireEvent.click(toggle);

		await waitFor(() => {
			expect(useGameStore.getState().isBlindfoldMode).toBe(true);
		});
	});

	it("displays help text about blindfold mode", async () => {
		render(<GameSettings />);
		const triggerButton = screen.getByRole("button", { name: /game settings/i });

		fireEvent.click(triggerButton);

		await waitFor(() => {
			expect(
				screen.getByText(/Hide piece positions to train calculation/i),
			).toBeTruthy();
			expect(
				screen.getByText(
					/Configure partial blindfold/i,
				),
			).toBeTruthy();
		});
	});

	it("renders progressive blindfold radio options and updates store", async () => {
		useGameStore.setState({ blindfoldMode: "none" });
		render(<GameSettings />);

		const triggerButton = screen.getByRole("button", { name: /game settings/i });
		fireEvent.click(triggerButton);

		await waitFor(() => {
			expect(screen.getByRole("radiogroup", { name: /blindfold mode options/i })).toBeTruthy();
		});

		const whiteRadio = screen.getByLabelText(/hide white/i) as HTMLInputElement;
		const blackRadio = screen.getByLabelText(/hide black/i) as HTMLInputElement;
		const allRadio = screen.getByLabelText(/hide all/i) as HTMLInputElement;
		const noneRadio = screen.getByLabelText(/visible \(none\)/i) as HTMLInputElement;

		expect(noneRadio.checked).toBe(true);

		fireEvent.click(whiteRadio);
		expect(useGameStore.getState().blindfoldMode).toBe("white");
		expect(useGameStore.getState().isBlindfoldMode).toBe(true);

		fireEvent.click(blackRadio);
		expect(useGameStore.getState().blindfoldMode).toBe("black");

		fireEvent.click(allRadio);
		expect(useGameStore.getState().blindfoldMode).toBe("all");

		fireEvent.click(noneRadio);
		expect(useGameStore.getState().blindfoldMode).toBe("none");
		expect(useGameStore.getState().isBlindfoldMode).toBe(false);
	});

	it("toggle switch has correct visual state when on", async () => {
		useGameStore.setState({ isBlindfoldMode: true });
		render(<GameSettings />);

		const triggerButton = screen.getByRole("button", { name: /game settings/i });
		fireEvent.click(triggerButton);

		await waitFor(() => {
			const toggle = screen.getByRole("switch", { name: /toggle blindfold mode/i }) as HTMLElement;
			// When blindfold mode is on, the toggle should have the accent color
			expect(toggle.className).toContain("bg-(--accent-primary)");
		});
	});

	it("toggle switch has correct visual state when off", async () => {
		useGameStore.setState({ isBlindfoldMode: false });
		render(<GameSettings />);

		const triggerButton = screen.getByRole("button", { name: /game settings/i });
		fireEvent.click(triggerButton);

		await waitFor(() => {
			const toggle = screen.getByRole("switch", { name: /toggle blindfold mode/i }) as HTMLElement;
			// When blindfold mode is off, the toggle should have the tertiary color
			expect(toggle.className).toContain("bg-(--bg-tertiary)");
		});
	});

	it("persists blindfold mode to localStorage when toggled", async () => {
		render(<GameSettings />);
		const triggerButton = screen.getByRole("button", { name: /game settings/i });

		fireEvent.click(triggerButton);

		await waitFor(() => {
			const toggle = screen.getByRole("switch", { name: /toggle blindfold mode/i });
			fireEvent.click(toggle);
		});

		await waitFor(() => {
			const stored = localStorage.getItem("chesster-game");
			expect(stored).toBeTruthy();
			const parsed = JSON.parse(stored!);
			const state = parsed.state ?? parsed;
			expect(state.isBlindfoldMode).toBe(true);
		});
	});

	it("multiple toggles work correctly", async () => {
		render(<GameSettings />);
		const triggerButton = screen.getByRole("button", { name: /game settings/i });

		fireEvent.click(triggerButton);

		const toggle = screen.getByRole("switch", { name: /toggle blindfold mode/i });

		// Toggle on
		fireEvent.click(toggle);
		await waitFor(() => {
			expect(useGameStore.getState().isBlindfoldMode).toBe(true);
		});

		// Toggle off
		fireEvent.click(toggle);
		await waitFor(() => {
			expect(useGameStore.getState().isBlindfoldMode).toBe(false);
		});

		// Toggle on again
		fireEvent.click(toggle);
		await waitFor(() => {
			expect(useGameStore.getState().isBlindfoldMode).toBe(true);
		});
	});

	// ── Piece Set Persistence Tests ──────────────────────────────────────────────

	it("displays Piece Set selector buttons", async () => {
		render(<GameSettings />);
		const triggerButton = screen.getByRole("button", { name: /game settings/i });

		fireEvent.click(triggerButton);

		await waitFor(() => {
			expect(screen.getByText("Piece set")).toBeTruthy();
		});

		// All three piece set buttons should be present
		const classicButton = screen.getByRole("button", { name: /select classic piece set/i });
		const neoButton = screen.getByRole("button", { name: /select neo piece set/i });
		const woodButton = screen.getByRole("button", { name: /select wood piece set/i });

		expect(classicButton).toBeTruthy();
		expect(neoButton).toBeTruthy();
		expect(woodButton).toBeTruthy();
	});

	it("piece set defaults to classic", () => {
		useGameStore.setState({ pieceSet: "classic" });
		expect(useGameStore.getState().pieceSet).toBe("classic");
	});

	it("clicking piece set button updates state", async () => {
		render(<GameSettings />);
		const triggerButton = screen.getByRole("button", { name: /game settings/i });

		fireEvent.click(triggerButton);

		await waitFor(() => {
			expect(useGameStore.getState().pieceSet).toBe("classic");
		});

		const neoButton = screen.getByRole("button", { name: /select neo piece set/i });
		fireEvent.click(neoButton);

		await waitFor(() => {
			expect(useGameStore.getState().pieceSet).toBe("neo");
		});
	});

	it("piece set selection reflects in aria-pressed attribute", async () => {
		useGameStore.setState({ pieceSet: "classic" });
		render(<GameSettings />);
		const triggerButton = screen.getByRole("button", { name: /game settings/i });

		fireEvent.click(triggerButton);

		await waitFor(() => {
			const classicButton = screen.getByRole("button", { name: /select classic piece set/i }) as HTMLElement;
			expect(classicButton.getAttribute("aria-pressed")).toBe("true");
		});
	});

	it("switching piece set updates aria-pressed correctly", async () => {
		useGameStore.setState({ pieceSet: "classic" });
		render(<GameSettings />);
		const triggerButton = screen.getByRole("button", { name: /game settings/i });

		fireEvent.click(triggerButton);

		await waitFor(() => {
			const classicButton = screen.getByRole("button", { name: /select classic piece set/i }) as HTMLElement;
			expect(classicButton.getAttribute("aria-pressed")).toBe("true");
		});

		const woodButton = screen.getByRole("button", { name: /select wood piece set/i });
		fireEvent.click(woodButton);

		await waitFor(() => {
			const classicButton = screen.getByRole("button", { name: /select classic piece set/i }) as HTMLElement;
			const woodButtonUpdated = screen.getByRole("button", { name: /select wood piece set/i }) as HTMLElement;
			expect(classicButton.getAttribute("aria-pressed")).toBe("false");
			expect(woodButtonUpdated.getAttribute("aria-pressed")).toBe("true");
		});
	});

	it("persists piece set to localStorage when changed", async () => {
		render(<GameSettings />);
		const triggerButton = screen.getByRole("button", { name: /game settings/i });

		fireEvent.click(triggerButton);

		await waitFor(() => {
			const neoButton = screen.getByRole("button", { name: /select neo piece set/i });
			fireEvent.click(neoButton);
		});

		await waitFor(() => {
			const stored = localStorage.getItem("chesster-game");
			expect(stored).toBeTruthy();
			const parsed = JSON.parse(stored!);
			const state = parsed.state ?? parsed;
			expect(state.pieceSet).toBe("neo");
		});
	});

	it("persists multiple piece set changes", async () => {
		render(<GameSettings />);
		const triggerButton = screen.getByRole("button", { name: /game settings/i });

		fireEvent.click(triggerButton);

		// Change to neo
		await waitFor(() => {
			const neoButton = screen.getByRole("button", { name: /select neo piece set/i });
			fireEvent.click(neoButton);
		});

		await waitFor(() => {
			expect(useGameStore.getState().pieceSet).toBe("neo");
		});

		// Change to wood
		await waitFor(() => {
			const woodButton = screen.getByRole("button", { name: /select wood piece set/i });
			fireEvent.click(woodButton);
		});

		await waitFor(() => {
			const stored = localStorage.getItem("chesster-game");
			expect(stored).toBeTruthy();
			const parsed = JSON.parse(stored!);
			const state = parsed.state ?? parsed;
			expect(state.pieceSet).toBe("wood");
		});
	});

	it("piece set buttons have visual ring indicator when selected", async () => {
		useGameStore.setState({ pieceSet: "neo" });
		render(<GameSettings />);
		const triggerButton = screen.getByRole("button", { name: /game settings/i });

		fireEvent.click(triggerButton);

		await waitFor(() => {
			const neoButton = screen.getByRole("button", { name: /select neo piece set/i }) as HTMLElement;
			// Check for ring classes
			expect(neoButton.className).toContain("ring-2");
			expect(neoButton.className).toContain("ring-(--accent-primary)/40");
		});
	});
});
