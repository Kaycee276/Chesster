import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ChatPanel from "../ChatPanel";
import { useGameStore } from "../../store/gameStore";

const sendChatMessage = vi.fn();

beforeEach(() => {
	HTMLElement.prototype.scrollIntoView = vi.fn();
	useGameStore.setState({
		playerColor: "white",
		status: "active",
		board: [],
		currentTurn: "white",
		moveHistory: [],
		viewingIndex: null,
		chatMessages: [
			{ id: "own", playerColor: "white", message: "Hello", createdAt: "2026-10-17T00:00:00Z" },
			{ id: "opponent", playerColor: "black", message: "Opponent message", createdAt: "2026-10-17T00:00:00Z" },
		],
		unreadCount: 0,
		chatOpen: true,
		isOpponentMuted: false,
		sendChatMessage,
	});
	sendChatMessage.mockClear();
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("ChatPanel quick phrases and mute", () => {
	it("sends a quick phrase with one click", () => {
		render(<ChatPanel inline activeTab="chat" />);

		fireEvent.click(screen.getByRole("button", { name: "Nice move!" }));

		expect(sendChatMessage).toHaveBeenCalledWith("Nice move!");
	});

	it("hides opponent messages while preserving own messages and can unmute", () => {
		render(<ChatPanel inline activeTab="chat" />);
		expect(screen.getByText("Opponent message")).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "Mute opponent" }));

		expect(screen.queryByText("Opponent message")).not.toBeInTheDocument();
		expect(screen.getByText("Hello")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Unmute opponent" }));
		expect(screen.getByText("Opponent message")).toBeInTheDocument();
	});

	it("does not increase unread count for muted incoming opponent messages", () => {
		useGameStore.setState({ isOpponentMuted: true, chatOpen: false, unreadCount: 2 });

		useGameStore.getState().addChatMessage({
			id: "incoming",
			playerColor: "black",
			message: "Muted notification",
			createdAt: "2026-10-17T00:00:00Z",
		});

		expect(useGameStore.getState().chatMessages.at(-1)?.message).toBe("Muted notification");
		expect(useGameStore.getState().unreadCount).toBe(2);
	});
});
