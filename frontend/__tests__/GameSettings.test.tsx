import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import GameSettings from "../src/components/GameSettings";
import { useGameStore } from "../src/store/gameStore";

describe("GameSettings Component", () => {
	beforeEach(() => {
		useGameStore.setState({
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
		const backdrop = screen.getByText("Game Settings").closest("div")?.parentElement;
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
			const toggle = screen.getByRole("switch") as HTMLElement;
			expect(toggle.getAttribute("aria-checked")).toBe("false");
		});

		// Toggle on
		useGameStore.setState({ isBlindfoldMode: true });

		await waitFor(() => {
			const toggle = screen.getByRole("switch") as HTMLElement;
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
					/When enabled, pieces appear as dots. Use the peek button/i,
				),
			).toBeTruthy();
		});
	});

	it("toggle switch has correct visual state when on", async () => {
		useGameStore.setState({ isBlindfoldMode: true });
		render(<GameSettings />);

		const triggerButton = screen.getByRole("button", { name: /game settings/i });
		fireEvent.click(triggerButton);

		await waitFor(() => {
			const toggle = screen.getByRole("switch") as HTMLElement;
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
			const toggle = screen.getByRole("switch") as HTMLElement;
			// When blindfold mode is off, the toggle should have the tertiary color
			expect(toggle.className).toContain("bg-(--bg-tertiary)");
		});
	});

	it("persists blindfold mode to localStorage when toggled", async () => {
		render(<GameSettings />);
		const triggerButton = screen.getByRole("button", { name: /game settings/i });

		fireEvent.click(triggerButton);

		await waitFor(() => {
			const toggle = screen.getByRole("switch");
			fireEvent.click(toggle);
		});

		await waitFor(() => {
			const stored = localStorage.getItem("chesster-game");
			expect(stored).toBeTruthy();
			const parsed = JSON.parse(stored!);
			expect(parsed.isBlindfoldMode).toBe(true);
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
});
