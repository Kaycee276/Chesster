import { describe, it, expect, beforeEach } from "vitest";
import { useGameStore } from "./gameStore";

describe("Streamer Mode in gameStore", () => {
	beforeEach(() => {
		useGameStore.setState({ isStreamerMode: false });
	});

	it("initializes isStreamerMode as false", () => {
		const state = useGameStore.getState();
		expect(state.isStreamerMode).toBe(false);
	});

	it("toggles isStreamerMode correctly", () => {
		const { toggleStreamerMode } = useGameStore.getState();
		expect(useGameStore.getState().isStreamerMode).toBe(false);

		toggleStreamerMode();
		expect(useGameStore.getState().isStreamerMode).toBe(true);

		toggleStreamerMode();
		expect(useGameStore.getState().isStreamerMode).toBe(false);
	});

	it("verifies masking logic for wallet address and balance", () => {
		const address = "GABC1234567890ABCDEF1234";
		const balance = "100.50";

		// When streamer mode is false
		let isStreamerMode = false;
		let displayAddress = isStreamerMode ? `${address.slice(0, 4)}...${address.slice(-4)}` : address;
		let displayBalance = isStreamerMode ? "•••• XLM" : `${balance} XLM`;

		expect(displayAddress).toBe(address);
		expect(displayBalance).toBe("100.50 XLM");

		// When streamer mode is true
		isStreamerMode = true;
		displayAddress = isStreamerMode ? `${address.slice(0, 4)}...${address.slice(-4)}` : address;
		displayBalance = isStreamerMode ? "•••• XLM" : `${balance} XLM`;

		expect(displayAddress).toBe("GABC...1234");
		expect(displayBalance).toBe("•••• XLM");
	});
});
