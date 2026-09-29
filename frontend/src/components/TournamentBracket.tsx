import React, { useEffect, useState, useRef, useLayoutEffect } from "react";
import { BracketRound, BracketMatch } from "../types/tournament";
import { socketService } from "../api/socket";
import { useNavigate } from "react-router-dom";

interface TournamentBracketProps {
	rounds: BracketRound[];
	currentUserAddress?: string;
	onSpectate?: (gameCode: string) => void;
}

const BracketNode: React.FC<{
	match: BracketMatch;
	isCurrentUser: boolean;
	onSpectate: (gameCode: string) => void;
	nodeRef?: React.Ref<HTMLDivElement>;
}> = ({ match, isCurrentUser, onSpectate, nodeRef }) => {
	const isActive = match.status === "active";
	const isWhiteWinner = match.winner && match.playerWhite && match.winner === match.playerWhite.walletAddress;
	const isBlackWinner = match.winner && match.playerBlack && match.winner === match.playerBlack.walletAddress;

	return (
		<div ref={nodeRef} className="relative bg-slate-800 border border-slate-700 rounded-lg p-3 w-64 shadow-md z-10 m-4 flex-shrink-0">
			{isActive && (
				<div className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full animate-pulse border border-slate-900" title="Match is Live"></div>
			)}
			
			<div className={`flex justify-between items-center ${isWhiteWinner ? "font-bold text-green-400" : "text-slate-300"}`}>
				<span className="truncate pr-2">{match.playerWhite?.name || "TBD"}</span>
				<span>{match.whiteScore}</span>
			</div>
			
			<div className="h-px bg-slate-700 my-1"></div>
			
			<div className={`flex justify-between items-center ${isBlackWinner ? "font-bold text-green-400" : "text-slate-300"}`}>
				<span className="truncate pr-2">{match.playerBlack?.name || "TBD"}</span>
				<span>{match.blackScore}</span>
			</div>

			{isActive && match.gameCode && (
				<button
					onClick={() => onSpectate(match.gameCode as string)}
					className="mt-2 w-full py-1 text-xs bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold rounded transition-colors"
				>
					Spectate Live
				</button>
			)}
		</div>
	);
};

export const TournamentBracket: React.FC<TournamentBracketProps> = ({ rounds: initialRounds, currentUserAddress, onSpectate }) => {
	const [rounds, setRounds] = useState<BracketRound[]>(initialRounds);
	const navigate = useNavigate();
	const containerRef = useRef<HTMLDivElement>(null);
	const [lines, setLines] = useState<{ x1: number; y1: number; x2: number; y2: number }[]>([]);
	const nodeRefs = useRef<Map<string, HTMLDivElement>>(new Map());

	useEffect(() => {
		setRounds(initialRounds);
	}, [initialRounds]);

	useEffect(() => {
		const handleMatchCompleted = (completedMatch: BracketMatch) => {
			setRounds((prevRounds) => {
				const newRounds = [...prevRounds];
				for (let i = 0; i < newRounds.length; i++) {
					const matchIndex = newRounds[i].matches.findIndex(m => m.matchNumber === completedMatch.matchNumber);
					if (matchIndex !== -1) {
						newRounds[i].matches[matchIndex] = {
							...newRounds[i].matches[matchIndex],
							...completedMatch
						};
						break;
					}
				}
				return newRounds;
			});
		};

		socketService.onTournamentMatchCompleted(handleMatchCompleted);
		return () => {
			socketService.offTournamentMatchCompleted();
		};
	}, []);

	const drawLines = () => {
		if (!containerRef.current) return;
		const containerRect = containerRef.current.getBoundingClientRect();
		const newLines: { x1: number; y1: number; x2: number; y2: number }[] = [];

		rounds.forEach((round, roundIndex) => {
			if (roundIndex === rounds.length - 1) return; // No next round to connect to
			
			const nextRound = rounds[roundIndex + 1];
			
			round.matches.forEach((match, matchIndex) => {
				// Single elimination standard tree assumption: matchIndex pairs (0,1 -> 0), (2,3 -> 1)
				const nextMatchIndex = Math.floor(matchIndex / 2);
				const nextMatch = nextRound.matches[nextMatchIndex];
				
				if (!nextMatch) return;

				const el1 = nodeRefs.current.get(`match-${match.matchNumber}`);
				const el2 = nodeRefs.current.get(`match-${nextMatch.matchNumber}`);

				if (el1 && el2) {
					const rect1 = el1.getBoundingClientRect();
					const rect2 = el2.getBoundingClientRect();

					// Calculate center right of current node
					const x1 = rect1.right - containerRect.left + containerRef.current.scrollLeft;
					const y1 = rect1.top + rect1.height / 2 - containerRect.top + containerRef.current.scrollTop;

					// Calculate center left of next node
					const x2 = rect2.left - containerRect.left + containerRef.current.scrollLeft;
					const y2 = rect2.top + rect2.height / 2 - containerRect.top + containerRef.current.scrollTop;

					newLines.push({ x1, y1, x2, y2 });
				}
			});
		});

		setLines(newLines);
	};

	useLayoutEffect(() => {
		drawLines();
		window.addEventListener('resize', drawLines);
		return () => window.removeEventListener('resize', drawLines);
	}, [rounds]);

	const handleSpectate = (gameCode: string) => {
		if (onSpectate) {
			onSpectate(gameCode);
		} else {
			navigate(`/spectate/${gameCode}`);
		}
	};

	const setNodeRef = (matchNumber: number, el: HTMLDivElement | null) => {
		if (el) {
			nodeRefs.current.set(`match-${matchNumber}`, el);
		} else {
			nodeRefs.current.delete(`match-${matchNumber}`);
		}
	};

	return (
		<div className="relative w-full overflow-x-auto bg-slate-950 p-8 min-h-[600px] select-none touch-pan-x touch-pan-y" ref={containerRef} onScroll={drawLines}>
			<svg className="absolute top-0 left-0 min-w-full min-h-full pointer-events-none z-0" style={{ width: '100%', height: '100%' }}>
				{lines.map((line, i) => {
					// Draw an elbow line: horizontally right, then vertical, then horizontally right
					const midX = (line.x1 + line.x2) / 2;
					const path = `M ${line.x1} ${line.y1} L ${midX} ${line.y1} L ${midX} ${line.y2} L ${line.x2} ${line.y2}`;
					return (
						<path
							key={i}
							d={path}
							fill="none"
							stroke="#475569"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					);
				})}
			</svg>

			<div className="flex min-w-max">
				{rounds.map((round) => (
					<div
						key={round.roundNumber}
						className="flex flex-col justify-around relative min-w-[300px]"
					>
						<div className="absolute -top-4 left-0 right-0 text-center text-slate-500 font-bold tracking-wider text-sm mb-4">
							Round {round.roundNumber}
						</div>
						
						{round.matches.map((match) => {
							const isCurrentUser =
								(match.playerWhite?.walletAddress === currentUserAddress && currentUserAddress !== undefined) ||
								(match.playerBlack?.walletAddress === currentUserAddress && currentUserAddress !== undefined);

							return (
								<BracketNode
									key={match.matchNumber}
									nodeRef={(el) => setNodeRef(match.matchNumber, el)}
									match={match}
									isCurrentUser={isCurrentUser}
									onSpectate={handleSpectate}
								/>
							);
						})}
					</div>
				))}
			</div>
		</div>
	);
};
