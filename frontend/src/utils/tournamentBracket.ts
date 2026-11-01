export type MatchStatus = "pending" | "active" | "finished" | "awaiting_opponent";

export interface BracketPlayerInfo {
  id?: string;
  name: string;
  seed?: number;
  avatar?: string;
  score?: number;
}

export interface TreeMatch {
  id: string;
  roundIndex: number;
  matchIndex: number;
  gameCode?: string;
  status: MatchStatus;
  player1?: BracketPlayerInfo;
  player2?: BracketPlayerInfo;
  winnerId?: string;
}

export interface TreeRound {
  title: string;
  matches: TreeMatch[];
}

/**
 * Computes round tier names from match count or round index
 */
export function getRoundTierTitle(roundIndex: number, totalRounds: number): string {
  const fromFinals = totalRounds - 1 - roundIndex;
  switch (fromFinals) {
    case 0:
      return "Finals";
    case 1:
      return "Semifinals";
    case 2:
      return "Quarterfinals";
    case 3:
      return "Round of 16";
    default:
      return `Round ${roundIndex + 1}`;
  }
}

/**
 * Builds standard elimination rounds from matches if only matches are passed
 */
export function buildRoundsFromMatches(matches: TreeMatch[]): TreeRound[] {
  if (!matches || matches.length === 0) return [];

  const roundMap = new Map<number, TreeMatch[]>();
  matches.forEach((m) => {
    const list = roundMap.get(m.roundIndex) || [];
    list.push(m);
    roundMap.set(m.roundIndex, list);
  });

  const sortedRounds = Array.from(roundMap.keys()).sort((a, b) => a - b);
  const totalRounds = sortedRounds.length;

  return sortedRounds.map((rIdx) => ({
    title: getRoundTierTitle(rIdx, totalRounds),
    matches: roundMap.get(rIdx) || [],
  }));
}
