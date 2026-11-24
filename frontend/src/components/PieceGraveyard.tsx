import React from "react";
import { PIECE_SET_SYMBOLS, type PieceSetKey } from "../utils/themeStyles";

export interface PieceGraveyardProps {
	captured: string[];
	pieceSet?: PieceSetKey | "classic";
	materialLead?: number;
	className?: string;
}

const PIECE_DISPLAY_ORDER = ["q", "r", "b", "n", "p"];

/**
 * Visual piece capture graveyard tray with grouped pieces and net material lead badge.
 */
export default function PieceGraveyard({
	captured = [],
	pieceSet = "classic",
	materialLead = 0,
	className = "",
}: PieceGraveyardProps) {
	if (captured.length === 0 && materialLead <= 0) {
		return null;
	}

	const symbols = PIECE_SET_SYMBOLS[pieceSet] || PIECE_SET_SYMBOLS.classic;

	// Count occurrences of each piece type
	const counts: Record<string, number> = {};
	for (const p of captured) {
		const lower = p.toLowerCase();
		counts[lower] = (counts[lower] || 0) + 1;
	}

	// Order grouped pieces (Q, R, B, N, P)
	const orderedPieces: string[] = [];
	for (const type of PIECE_DISPLAY_ORDER) {
		const count = counts[type] || 0;
		for (let i = 0; i < count; i++) {
			// Retain the casing of the original captured piece
			const original = captured.find((c) => c.toLowerCase() === type);
			orderedPieces.push(original || type);
		}
	}

	return (
		<div className={`flex items-center gap-1.5 shrink-0 ${className}`}>
			{orderedPieces.length > 0 && (
				<div className="flex overflow-hidden shrink-0" style={{ maxWidth: "7rem" }}>
					{orderedPieces.map((p, idx) => (
						<span
							key={idx}
							className="text-base leading-none select-none -mr-1 last:mr-0 drop-shadow-xs"
							aria-hidden="true"
						>
							{symbols[p] ?? p}
						</span>
					))}
				</div>
			)}
			{materialLead > 0 && (
				<span
					className="text-[10px] font-bold text-green-400 shrink-0 tabular-nums"
					title={`+${materialLead} material lead`}
				>
					+{materialLead}
				</span>
			)}
		</div>
	);
}
