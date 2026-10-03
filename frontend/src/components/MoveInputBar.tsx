import { useRef, useState } from "react";
import { CornerDownLeft, Keyboard } from "lucide-react";
import { resolveSan } from "../utils/sanResolver";

/**
 * MoveInputBar (#315)
 *
 * Quick-move command bar for keyboard-only play: type a move in standard
 * algebraic notation ("e4", "Qxd5+", "O-O", "e8=Q") and press Enter to play
 * it. The typed move is validated against the current board before it is
 * submitted, so illegal text never reaches the game API.
 *
 * Accessibility: the input is labelled, errors are announced through a
 * polite live region, and a global "/" or "M" shortcut (owned by the parent
 * board) focuses the field.
 */

interface MoveInputBarProps {
	board: string[][];
	turn: "white" | "black";
	/** Whether it is this player's turn to move; disables input otherwise. */
	isPlayerTurn: boolean;
	/** Submits a validated move to the game. */
	onMove: (from: [number, number], to: [number, number], promotion?: string) => void;
	/** Set by the parent so "/" and "M" can focus the field. */
	focusRef?: React.RefObject<HTMLInputElement | null>;
}

export default function MoveInputBar({
	board,
	turn,
	isPlayerTurn,
	onMove,
	focusRef,
}: MoveInputBarProps) {
	const [value, setValue] = useState("");
	const [errorState, setErrorState] = useState<{
		posKey: string;
		message: string;
	} | null>(null);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const input = focusRef ?? inputRef;

	// The error is tagged with the position it was produced for, so a stale
	// message from an earlier position never lingers — a move that was illegal
	// two plies ago may be legal now. Derived during render; no effect needed.
	const posKey = `${turn}|${board.map((row) => row.join("")).join("/")}`;
	const error =
		errorState && errorState.posKey === posKey ? errorState.message : null;

	const handleSubmit = () => {
		const text = value.trim();
		if (text.length === 0) return;

		const move = resolveSan(board, text, turn);
		if (!move) {
			setErrorState({ posKey, message: `Invalid move: ${text}` });
			return;
		}
		setValue("");
		setErrorState(null);
		onMove(move.from, move.to, move.promotion);
	};

	return (
		<div className="flex flex-col gap-1">
			<div className="flex items-center gap-2">
				<Keyboard
					size={14}
					className="text-(--text-tertiary) shrink-0"
					aria-hidden="true"
				/>
				<input
					ref={input}
					value={value}
					onChange={(e) => {
						setValue(e.target.value);
						if (errorState) setErrorState(null);
					}}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							handleSubmit();
						}
					}}
					disabled={!isPlayerTurn}
					placeholder={
						isPlayerTurn
							? "Type a move (e4, Nf3, O-O) and press Enter"
							: "Waiting for opponent…"
					}
					aria-label="Quick move input in algebraic notation"
					aria-describedby="move-input-hint"
					aria-invalid={error ? true : undefined}
					spellCheck={false}
					autoCapitalize="off"
					autoComplete="off"
					className="flex-1 min-w-0 bg-(--bg) border border-(--border) rounded-lg px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:border-(--accent-primary)/60 disabled:opacity-50"
				/>
				<button
					type="button"
					onClick={handleSubmit}
					disabled={!isPlayerTurn || value.trim().length === 0}
					aria-label="Play typed move"
					className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-(--bg) border border-(--border) hover:border-(--accent-primary)/60 disabled:opacity-50 transition-colors"
				>
					<CornerDownLeft size={13} aria-hidden="true" />
					Move
				</button>
			</div>
			<span id="move-input-hint" className="sr-only">
				Press slash or M to focus, type the move in algebraic notation, then
				press Enter to play it.
			</span>
			<div role="status" aria-live="polite" className="sr-only">
				{error ?? ""}
			</div>
			{error && (
				<p
					className="text-xs text-red-400"
					aria-hidden="true"
				>
					{error}
				</p>
			)}
		</div>
	);
}
