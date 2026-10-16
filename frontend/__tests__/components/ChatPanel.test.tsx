import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import ChatPanel, { QUICK_PHRASES } from "../../src/components/ChatPanel";
import { useGameStore } from "../../src/store/gameStore";
import { socketService } from "../../src/api/socket";

vi.mock("../../src/api/socket", () => ({
	socketService: {
		connect: vi.fn(),
		disconnect: vi.fn(),
		joinGame: vi.fn(),
		leaveGame: vi.fn(),
		onGameUpdate: vi.fn(),
		onChatMessage: vi.fn(),
		offGameUpdate: vi.fn(),
		offChatMessage: vi.fn(),
		sendChatMessage: vi.fn(),
	},
}));

vi.mock("../../src/api/gameApi", () => ({
	api: {
		getChatHistory: vi.fn().mockResolvedValue({ success: true, data: [] }),
	},
}));

describe("ChatPanel - Quick Chat Phrases & Opponent Mute", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		window.HTMLElement.prototype.scrollIntoView = vi.fn();
		useGameStore.setState({
			gameCode: "GAME123",
			playerColor: "white",
			status: "active",
			chatOpen: true,
			unreadCount: 0,
			isOpponentMuted: false,
			chatMessages: [],
		});
	});

	it("renders all quick phrase pill buttons", () => {
		render(<ChatPanel inline={true} />);

		for (const phrase of QUICK_PHRASES) {
			expect(screen.getByRole("button", { name: phrase })).toBeInTheDocument();
		}
	});

	it("sends message and dispatches to socket when a quick phrase pill is clicked", () => {
		render(<ChatPanel inline={true} />);

		const quickPhrase = QUICK_PHRASES[0]; // "Good luck!"
		const button = screen.getByRole("button", { name: quickPhrase });
		fireEvent.click(button);

		expect(socketService.sendChatMessage).toHaveBeenCalledWith(
			"GAME123",
			"white",
			quickPhrase
		);
	});

	it("renders the VolumeX mute opponent button in the chat header", () => {
		render(<ChatPanel inline={true} />);

		const muteBtn = screen.getByRole("button", { name: /mute opponent/i });
		expect(muteBtn).toBeInTheDocument();
	});

	it("toggles isOpponentMuted when the mute button is clicked", () => {
		render(<ChatPanel inline={true} />);

		const muteBtn = screen.getByRole("button", { name: /mute opponent/i });
		expect(useGameStore.getState().isOpponentMuted).toBe(false);

		fireEvent.click(muteBtn);
		expect(useGameStore.getState().isOpponentMuted).toBe(true);

		fireEvent.click(muteBtn);
		expect(useGameStore.getState().isOpponentMuted).toBe(false);
	});

	it("hides opponent messages when isOpponentMuted is true", () => {
		useGameStore.setState({
			playerColor: "white",
			isOpponentMuted: true,
			chatMessages: [
				{
					id: "msg-1",
					gameCode: "GAME123",
					playerColor: "black",
					message: "You cannot see this",
					createdAt: new Date().toISOString(),
				},
				{
					id: "msg-2",
					gameCode: "GAME123",
					playerColor: "white",
					message: "I can see my own message",
					createdAt: new Date().toISOString(),
				},
			],
		});

		render(<ChatPanel inline={true} />);

		expect(screen.queryByText("You cannot see this")).not.toBeInTheDocument();
		expect(screen.getByText("I can see my own message")).toBeInTheDocument();
	});

	it("shows opponent messages when isOpponentMuted is false", () => {
		useGameStore.setState({
			playerColor: "white",
			isOpponentMuted: false,
			chatMessages: [
				{
					id: "msg-1",
					gameCode: "GAME123",
					playerColor: "black",
					message: "Hello white player!",
					createdAt: new Date().toISOString(),
				},
			],
		});

		render(<ChatPanel inline={true} />);

		expect(screen.getByText("Hello white player!")).toBeInTheDocument();
	});

	it("does not increment unreadCount for incoming opponent messages when opponent is muted and chat is closed", () => {
		useGameStore.setState({
			playerColor: "white",
			chatOpen: false,
			isOpponentMuted: true,
			unreadCount: 0,
		});

		useGameStore.getState().addChatMessage({
			id: "msg-1",
			gameCode: "GAME123",
			playerColor: "black",
			message: "Spam message",
			createdAt: new Date().toISOString(),
		});

		expect(useGameStore.getState().unreadCount).toBe(0);
	});
});
