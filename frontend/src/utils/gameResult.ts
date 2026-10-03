export type GameOutcome = "win" | "loss" | "draw";

/** Determines the result of a finished game from this client's perspective. */
export function getGameOutcome(
	winner: string | null | undefined,
	playerColor: "white" | "black" | null,
): GameOutcome {
	if (winner === "draw") return "draw";
	if (!playerColor) return "loss";
	return winner === playerColor ? "win" : "loss";
}

const END_REASON_LABELS: Record<string, string> = {
	checkmate: "Checkmate",
	resignation: "Resignation",
	stalemate: "Stalemate",
	time: "Time Out",
	disconnect: "Opponent Disconnected",
	draw_agreed: "Draw Agreed",
	threefold_repetition: "Threefold Repetition",
	fivefold_repetition: "Fivefold Repetition",
	"50_move_rule": "50-Move Rule",
	"75_move_rule": "75-Move Rule",
};

/** Maps a backend `end_reason` code to a human-readable label. */
export function getEndReasonLabel(endReason?: string | null): string {
	if (!endReason) return "Game Over";
	return END_REASON_LABELS[endReason] ?? endReason;
}

/** Headline shown at the top of the result modal. */
export function buildResultTitle(outcome: GameOutcome): string {
	if (outcome === "win") return "You Win!";
	if (outcome === "loss") return "You Lose";
	return "Draw!";
}

/** Tweet body for the "Share on X" action. */
export function buildShareText(
	outcome: GameOutcome,
	gameCode?: string | null,
): string {
	const resultPhrase =
		outcome === "win" ? "won" : outcome === "loss" ? "lost" : "drew";
	const codePart = gameCode ? ` (Game ${gameCode})` : "";
	return `I just ${resultPhrase} a chess match on @ChessterGame!${codePart} Check it out!`;
}

/** Builds a twitter.com/intent/tweet share URL for the given text/link. */
export function buildTwitterShareUrl(shareText: string, gameUrl?: string): string {
	const params = new URLSearchParams({ text: shareText });
	if (gameUrl) params.set("url", gameUrl);
	return `https://twitter.com/intent/tweet?${params.toString()}`;
}
