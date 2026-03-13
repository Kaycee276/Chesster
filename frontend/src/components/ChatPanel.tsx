import { useState, useRef, useEffect } from "react";
import { MessageCircle, X, Send } from "lucide-react";
import { useGameStore } from "../store/gameStore";

const MAX_CHARS = 50;

export default function ChatPanel() {
	const playerColor = useGameStore((s) => s.playerColor);
	const chatMessages = useGameStore((s) => s.chatMessages);
	const unreadCount = useGameStore((s) => s.unreadCount);
	const chatOpen = useGameStore((s) => s.chatOpen);
	const setChatOpen = useGameStore((s) => s.setChatOpen);
	const sendChatMessage = useGameStore((s) => s.sendChatMessage);
	const status = useGameStore((s) => s.status);

	const [input, setInput] = useState("");
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	// Scroll to bottom when new messages arrive or panel opens
	useEffect(() => {
		if (chatOpen) {
			messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
		}
	}, [chatMessages, chatOpen]);

	// Focus input when panel opens
	useEffect(() => {
		if (chatOpen) {
			setTimeout(() => inputRef.current?.focus(), 50);
		}
	}, [chatOpen]);

	const handleSend = () => {
		const trimmed = input.trim().slice(0, MAX_CHARS);
		if (!trimmed) return;
		sendChatMessage(trimmed);
		setInput("");
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter") handleSend();
	};

	// Only show during active or finished games
	if (status !== "active" && status !== "finished") return null;

	return (
		<div className="fixed bottom-[52px] right-2 z-40 flex flex-col items-end gap-2">
			{/* Chat panel */}
			{chatOpen && (
				<div className="w-72 sm:w-80 bg-(--bg-secondary) border border-(--border) rounded-2xl shadow-2xl flex flex-col overflow-hidden"
					style={{ height: "320px" }}
				>
					{/* Header */}
					<div className="flex items-center justify-between px-3 py-2 border-b border-(--border) shrink-0">
						<div className="flex items-center gap-1.5">
							<MessageCircle size={13} className="text-(--text-tertiary)" />
							<span className="text-xs font-semibold text-(--text-secondary) uppercase tracking-wider">
								Chat
							</span>
						</div>
						<button
							onClick={() => setChatOpen(false)}
							className="text-(--text-tertiary) hover:text-(--text) transition-colors p-0.5 rounded"
						>
							<X size={13} />
						</button>
					</div>

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
											{msg.message}
										</div>
									</div>
								);
							})
						)}
						<div ref={messagesEndRef} />
					</div>

					{/* Input */}
					<div className="shrink-0 flex items-center gap-1.5 px-2 py-2 border-t border-(--border)">
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
				</div>
			)}

			{/* Toggle button */}
			<button
				onClick={() => setChatOpen(!chatOpen)}
				className="relative w-10 h-10 rounded-full bg-(--bg-secondary) border border-(--border) hover:border-(--accent-primary)/60 flex items-center justify-center text-(--text-secondary) hover:text-(--text) transition-colors shadow-lg"
				title={chatOpen ? "Close chat" : "Open chat"}
			>
				<MessageCircle size={16} />
				{unreadCount > 0 && !chatOpen && (
					<span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
						{unreadCount > 9 ? "9+" : unreadCount}
					</span>
				)}
			</button>
		</div>
	);
}
