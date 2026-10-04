import { useState, useRef, useEffect } from "react";
import { MessageCircle, X, Send, Smile, Download, Check } from "lucide-react";
import { useGameStore } from "../store/gameStore";
import { boardToFen, moveToAlgebraic } from "../utils/chessUtils";
import { sanitizeChatMessage } from "../utils/sanitize";

const MAX_CHARS = 50;
const QUICK_REACTIONS = ["Good luck!", "Nice move", "Well played", "Good game"];
const EMOJI_REACTIONS = ["😀", "🔥", "👏", "🤝", "♟️", "🏆"];

interface ChatPanelProps {
	inline?: boolean;
	activeTab?: "chat" | "moves";
	onTabChange?: (tab: "chat" | "moves") => void;
	onClose?: () => void;
	showCloseButton?: boolean;
}

export default function ChatPanel({
	inline = false,
	activeTab: externalTab,
	onTabChange,
	onClose,
	showCloseButton,
}: ChatPanelProps = {}) {
	const playerColor = useGameStore((s) => s.playerColor);
	const chatMessages = useGameStore((s) => s.chatMessages);
	const unreadCount = useGameStore((s) => s.unreadCount);
	const chatOpen = useGameStore((s) => s.chatOpen);
	const setChatOpen = useGameStore((s) => s.setChatOpen);
	const sendChatMessage = useGameStore((s) => s.sendChatMessage);
	const status = useGameStore((s) => s.status);
	const board = useGameStore((s) => s.board);
	const currentTurn = useGameStore((s) => s.currentTurn);

	const [input, setInput] = useState("");
	const [emojiOpen, setEmojiOpen] = useState(false);
	const [copiedFen, setCopiedFen] = useState(false);
	const [internalTab, setInternalTab] = useState<"chat" | "moves">("chat");
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	const activeTab = externalTab ?? internalTab;
	const setActiveTab = (tab: "chat" | "moves") => {
		setInternalTab(tab);
		onTabChange?.(tab);
	};

	const moveHistory = useGameStore((s) => s.moveHistory);
	const viewingIndex = useGameStore((s) => s.viewingIndex);
	const setViewingIndex = useGameStore((s) => s.setViewingIndex);

	const isOpen = inline || chatOpen;

	const handleClose = () => {
		setChatOpen(false);
		onClose?.();
	};

	// Scroll to bottom when new messages arrive or panel opens
	useEffect(() => {
		if (isOpen && activeTab === "chat") {
			messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
		}
	}, [chatMessages, isOpen, activeTab]);

	// Keep the active move in view while browsing the history panel
	useEffect(() => {
		if (isOpen && activeTab === "moves" && viewingIndex !== null) {
			document
				.getElementById(`move-${viewingIndex}`)
				?.scrollIntoView({ block: "nearest" });
		}
	}, [isOpen, activeTab, viewingIndex, moveHistory.length]);

	// Focus input when panel opens
	useEffect(() => {
		if (isOpen && activeTab === "chat") {
			setTimeout(() => inputRef.current?.focus(), 50);
		}
	}, [isOpen, activeTab]);

	const sendMessage = (message: string) => {
		const trimmed = message.trim().slice(0, MAX_CHARS);
		if (!trimmed) return;
		sendChatMessage(trimmed);
		setInput("");
		setEmojiOpen(false);
	};

	const handleSend = () => {
		sendMessage(input);
	};

	const appendEmoji = (emoji: string) => {
		setInput((current) => `${current}${emoji}`.slice(0, MAX_CHARS));
		inputRef.current?.focus();
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter") handleSend();
	};

	// Only show during active or finished games
	if (status !== "active" && status !== "finished") return null;

	const panelContent = (
		<div className={`flex flex-col overflow-hidden ${inline ? "w-full h-full flex-1 min-h-0" : "w-full h-full"}`}>
			{/* Header */}
			<div className="flex items-center justify-between px-3 py-2 border-b border-(--border) shrink-0 gap-1 bg-(--bg-secondary)">
				<div className="flex items-center gap-1">
					<button
						type="button"
						onClick={() => setActiveTab("chat")}
						className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold uppercase tracking-wider transition-colors ${
							activeTab === "chat"
								? "bg-(--bg-tertiary) text-(--text)"
								: "text-(--text-tertiary) hover:text-(--text)"
						}`}
					>
						<MessageCircle size={13} />
						Chat
						{unreadCount > 0 && activeTab === "chat" && (
							<span className="min-w-[14px] h-3.5 px-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
								{unreadCount > 9 ? "9+" : unreadCount}
							</span>
						)}
					</button>
					<button
						type="button"
						onClick={() => setActiveTab("moves")}
						className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold uppercase tracking-wider transition-colors ${
							activeTab === "moves"
								? "bg-(--bg-tertiary) text-(--text)"
								: "text-(--text-tertiary) hover:text-(--text)"
						}`}
					>
						Moves ({moveHistory.length})
					</button>
				</div>
				<div className="flex items-center gap-1">
					{activeTab === "chat" && (
						<button
							title="Copy FEN to clipboard"
							onClick={() => {
								if (!board.length) return;
								const fen = boardToFen(board, currentTurn);
								navigator.clipboard.writeText(fen).then(() => {
									setCopiedFen(true);
									setTimeout(() => setCopiedFen(false), 1500);
								}).catch(() => {});
							}}
							className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-(--text-tertiary) hover:text-(--text) hover:bg-(--bg-tertiary) transition-colors"
						>
							{copiedFen ? <Check size={12} className="text-green-400" /> : <Download size={12} />}
							FEN
						</button>
					)}
					{(showCloseButton || !inline) && (
						<button
							onClick={handleClose}
							className="text-(--text-tertiary) hover:text-(--text) transition-colors p-1 rounded-lg hover:bg-(--bg-tertiary)"
							aria-label="Close"
						>
							<X size={15} />
						</button>
					)}
				</div>
			</div>

					{activeTab === "chat" ? (
						<>
							{/* Messages */}
					<div className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-1.5 min-h-0">
						{chatMessages.length === 0 ? (
							<p className="text-xs text-(--text-tertiary) text-center mt-6">
								No messages yet. Say hi!
							</p>
						) : (
							chatMessages.map((msg) => {
								const isMe = msg.playerColor === playerColor;
								return (
									<div
										key={msg.id}
										className={`flex ${isMe ? "justify-end" : "justify-start"}`}
									>
										<div
											className={`max-w-[85%] px-2.5 py-1.5 rounded-xl text-xs leading-snug break-words ${
												isMe
													? "bg-(--accent-primary) text-white rounded-br-sm"
													: "bg-(--bg-tertiary) text-(--text) rounded-bl-sm"
											}`}
										>
											{!isMe && (
												<span
													className={`block text-[10px] font-semibold mb-0.5 ${
														msg.playerColor === "white"
															? "text-gray-400"
															: "text-gray-500"
													}`}
												>
													{msg.playerColor}
												</span>
											)}
											{sanitizeChatMessage(msg.message)}
										</div>
									</div>
								);
							})
						)}
						<div ref={messagesEndRef} />
					</div>

					{/* Quick reactions */}
					<div className="shrink-0 flex flex-wrap gap-1.5 px-2 py-2 border-t border-(--border) bg-(--bg)/50">
						{QUICK_REACTIONS.map((reaction) => (
							<button
								key={reaction}
								type="button"
								onClick={() => sendMessage(reaction)}
								className="rounded-full border border-(--border) px-2 py-1 text-[10px] text-(--text-secondary) hover:border-(--accent-primary)/60 hover:text-(--text) transition-colors"
							>
								{reaction}
							</button>
						))}
					</div>

					{/* Input */}
					<div className="relative shrink-0 flex items-center gap-1.5 px-2 py-2 border-t border-(--border)">
						{emojiOpen && (
							<div className="absolute bottom-full left-2 mb-2 grid grid-cols-6 gap-1 rounded-xl border border-(--border) bg-(--bg-secondary) p-2 shadow-xl">
								{EMOJI_REACTIONS.map((emoji) => (
									<button
										key={emoji}
										type="button"
										onClick={() => appendEmoji(emoji)}
										className="flex h-7 w-7 items-center justify-center rounded-lg text-sm hover:bg-(--bg-tertiary) transition-colors"
									>
										{emoji}
									</button>
								))}
							</div>
						)}
						<button
							type="button"
							onClick={() => setEmojiOpen((open) => !open)}
							className="p-1.5 rounded-lg border border-(--border) text-(--text-tertiary) hover:text-(--text) hover:border-(--accent-primary)/60 transition-colors shrink-0"
							title="Add emoji"
						>
							<Smile size={12} />
						</button>
						<input
							ref={inputRef}
							type="text"
							value={input}
							onChange={(e) => setInput(e.target.value.slice(0, MAX_CHARS))}
							onKeyDown={handleKeyDown}
							placeholder="Message…"
							maxLength={MAX_CHARS}
							className="flex-1 min-w-0 bg-(--bg) border border-(--border) rounded-lg px-2.5 py-1.5 text-xs text-(--text) placeholder:text-(--text-tertiary) outline-none focus:border-(--accent-primary)/60 transition-colors"
						/>
						<span className="text-[10px] text-(--text-tertiary) shrink-0 w-6 text-right">
							{MAX_CHARS - input.length}
						</span>
						<button
							onClick={handleSend}
							disabled={!input.trim()}
							className="p-1.5 rounded-lg bg-(--accent-primary) hover:bg-(--accent-dark) text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
						>
							<Send size={12} />
						</button>
					</div>
						</>
					) : (
						/* Move history navigation (#112) */
						<div className="flex-1 flex flex-col min-h-0">
							<div className="flex items-center justify-between px-3 py-1.5 border-b border-(--border) shrink-0">
								<span className="text-[10px] font-semibold uppercase tracking-wider text-(--text-tertiary)">
									Playback
								</span>
								<button
									type="button"
									onClick={() => setViewingIndex(null)}
									disabled={viewingIndex === null}
									className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-colors disabled:cursor-not-allowed ${
										viewingIndex === null
											? "bg-(--bg-tertiary) text-(--text-secondary)"
											: "bg-(--accent-dark) hover:bg-(--accent-primary) text-white"
									}`}
								>
									Live
								</button>
							</div>
							<div className="flex-1 overflow-y-auto px-2 py-1.5 min-h-0">
								{moveHistory.length === 0 ? (
									<p className="text-xs text-(--text-tertiary) text-center mt-6">
										No moves yet.
									</p>
								) : (
									<div className="flex flex-col gap-0.5">
										{moveHistory.map((move, index) => {
											const isActive = viewingIndex === index;
											return (
												<button
													key={`${move.move_number}-${move.player}`}
													id={`move-${index}`}
													type="button"
													onClick={() => setViewingIndex(index)}
													className={`flex items-center gap-2 w-full text-left rounded-md px-1.5 py-1 text-[11px] font-mono transition-colors ${
														isActive
															? "bg-(--accent-primary)/20 text-(--text)"
															: "text-(--text-secondary) hover:bg-(--bg-tertiary) hover:text-(--text)"
													}`}
												>
													<span className="w-8 shrink-0 text-(--text-tertiary)">
														{move.player === "white"
															? `${move.move_number}.`
															: `${move.move_number}…`}
													</span>
													<span className="flex-1 truncate">
														{moveToAlgebraic(
															move.from_position,
															move.to_position,
															move.promotion,
														)}
													</span>
													{move.is_checkmate && (
														<span className="text-(--accent-primary) shrink-0">#</span>
													)}
													{move.is_check && !move.is_checkmate && (
														<span className="text-(--text-tertiary) shrink-0">+</span>
													)}
												</button>
											);
										})}
									</div>
								)}
							</div>
						</div>
					)}
				</div>
	);

	if (inline) {
		return panelContent;
	}

	if (!chatOpen) return null;

	return (
		<div
			className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4"
			onClick={handleClose}
		>
			<div
				className="w-full sm:max-w-md bg-(--bg-secondary) border-t sm:border border-(--border) rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col h-[75vh] sm:h-[480px] overflow-hidden"
				onClick={(e) => e.stopPropagation()}
			>
				{panelContent}
			</div>
		</div>
	);
}
