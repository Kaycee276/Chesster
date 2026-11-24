import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
	it.each([
		"Good luck, have fun! ♟️",
		"Well played! 👏",
		"Thank you for the game! 🤝",
		"Rematch? ⚔️",
	])("sends the preset %s with one click", (preset) => {
		render(<ChatPanel inline activeTab="chat" />);

		fireEvent.click(screen.getByRole("button", { name: `Send ${preset}` }));

		expect(sendChatMessage).toHaveBeenCalledExactlyOnceWith(preset);
	});

	it.each(["👍", "👏", "😮", "♟️", "🔥", "🤝"])("sends %s immediately and renders the socket response", (emoji) => {
		sendChatMessage.mockImplementationOnce((message: string) => {
			useGameStore.getState().addChatMessage({ id: "reaction", playerColor: "white", message, createdAt: "2026-11-19T00:00:00Z" });
		});
		render(<ChatPanel inline />);
		fireEvent.click(screen.getByRole("button", { name: new RegExp(`Send .* reaction ${emoji}`) }));
		expect(sendChatMessage).toHaveBeenCalledExactlyOnceWith(emoji);
		expect(screen.getAllByText(emoji)).toHaveLength(2);
	});

	it("supports keyboard activation and preserves the typed draft", async () => {
		const user = userEvent.setup();
		render(<ChatPanel inline />);
		await waitFor(() => expect(screen.getByRole("textbox", { name: "Chat message" })).toHaveFocus());
		fireEvent.change(screen.getByRole("textbox", { name: "Chat message" }), { target: { value: "My draft" } });
		const preset = screen.getByRole("button", { name: "Send Rematch? ⚔️" });
		preset.focus();
		await user.keyboard("{Enter}");
		const reaction = screen.getByRole("button", { name: "Send Thumbs up reaction 👍" });
		reaction.focus();
		await user.keyboard(" ");
		expect(sendChatMessage.mock.calls).toEqual([["Rematch? ⚔️"], ["👍"]]);
		expect(screen.getByRole("textbox", { name: "Chat message" })).toHaveValue("My draft");
	});

	it("keeps emoji composition available without sending until requested", () => {
		render(<ChatPanel inline />);
		fireEvent.click(screen.getByRole("button", { name: "Add emoji" }));
		fireEvent.click(screen.getByRole("button", { name: "Add Fire emoji 🔥" }));
		expect(sendChatMessage).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));
		expect(sendChatMessage).toHaveBeenCalledExactlyOnceWith("🔥");
	});

	it("hides quick chat controls on the moves tab", () => {
		render(<ChatPanel inline activeTab="moves" />);
		expect(screen.queryByRole("group", { name: "Quick chat presets" })).not.toBeInTheDocument();
		expect(screen.queryByRole("group", { name: "Emoji reactions" })).not.toBeInTheDocument();
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
