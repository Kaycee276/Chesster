export interface BracketPlayer {
	walletAddress: string;
	name: string;
	rating?: number;
}

export interface BracketMatch {
	matchNumber: number;
	gameCode: string | null;
	playerWhite: BracketPlayer | null;
	playerBlack: BracketPlayer | null;
	whiteScore: number;
	blackScore: number;
	winner: string | null;
	status: "pending" | "active" | "resolved";
}

export interface BracketRound {
	roundNumber: number;
	matches: BracketMatch[];
}
