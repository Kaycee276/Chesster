import React from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  buildRoundsFromMatches,
  type TreeMatch,
  type TreeRound,
  type MatchStatus,
  type BracketPlayerInfo,
} from "../utils/tournamentBracket";

export type { TreeMatch, TreeRound, MatchStatus, BracketPlayerInfo };

export interface TournamentBracketTreeProps {
  matches?: TreeMatch[];
  rounds?: TreeRound[];
  onMatchClick?: (gameCode: string) => void;
  status?: string;
}

export const TournamentBracketTree: React.FC<TournamentBracketTreeProps> = ({
  matches = [],
  rounds: initialRounds,
  onMatchClick,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const rounds = initialRounds && initialRounds.length > 0
    ? initialRounds
    : buildRoundsFromMatches(matches);

  const handleMatchSelect = (match: TreeMatch) => {
    if (match.gameCode) {
      if (onMatchClick) {
        onMatchClick(match.gameCode);
      } else {
        navigate(`/game/${match.gameCode}`);
      }
    }
  };

  return (
    <div
      data-testid="tournament-bracket-tree"
      className="relative w-full overflow-x-auto overflow-y-auto p-4 select-none"
    >
      <div className="flex gap-12 min-w-max items-center justify-start py-4">
        {rounds.map((round, rIndex) => (
          <div
            key={round.title || rIndex}
            data-testid={`bracket-round-${rIndex}`}
            className="flex flex-col gap-6"
          >
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 text-center">
              {t(`tournament.${round.title.toLowerCase()}`, round.title)}
            </h3>

            <div className="flex flex-col justify-around gap-8 flex-1">
              {round.matches.map((m) => {
                const isActive = m.status === "active";
                const isFinished = m.status === "finished";
                const p1Winner = isFinished && m.winnerId && m.player1 && m.winnerId === m.player1.id;
                const p2Winner = isFinished && m.winnerId && m.player2 && m.winnerId === m.player2.id;

                return (
                  <div
                    key={m.id}
                    data-testid={`matchup-card-${m.id}`}
                    onClick={() => handleMatchSelect(m)}
                    className={`relative w-64 rounded-xl border p-3 bg-slate-800 transition-all ${
                      m.gameCode ? "cursor-pointer hover:border-amber-400 hover:shadow-lg" : ""
                    } ${
                      isActive
                        ? "border-green-500 shadow-[0_0_12px_rgba(34,197,94,0.35)]"
                        : "border-slate-700"
                    }`}
                  >
                    {/* Live pulse indicator */}
                    {isActive && (
                      <div className="absolute -top-1.5 -right-1.5 flex items-center gap-1 bg-green-500 text-slate-950 font-extrabold text-[10px] px-2 py-0.5 rounded-full shadow-sm animate-pulse">
                        <span className="w-1.5 h-1.5 rounded-full bg-white" />
                        {t("tournament.live", "LIVE")}
                      </div>
                    )}

                    {/* Match status badge if not active */}
                    {!isActive && (
                      <div className="text-[10px] uppercase font-semibold text-slate-400 mb-1.5 flex justify-between items-center">
                        <span>
                          {m.status === "finished"
                            ? t("tournament.finished", "Finished")
                            : m.status === "awaiting_opponent"
                            ? t("tournament.awaitingOpponent", "Awaiting Opponent")
                            : t("tournament.scheduled", "Pending")}
                        </span>
                      </div>
                    )}

                    {/* Player 1 */}
                    <div
                      className={`flex items-center justify-between text-sm py-1 px-1.5 rounded ${
                        p1Winner ? "bg-green-950/40 text-green-400 font-bold" : "text-slate-200"
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        {m.player1?.seed !== undefined && (
                          <span className="text-[10px] font-mono text-slate-400 bg-slate-700 px-1 rounded">
                            {m.player1.seed}
                          </span>
                        )}
                        {m.player1?.avatar && (
                          <img
                            src={m.player1.avatar}
                            alt=""
                            className="w-5 h-5 rounded-full object-cover"
                          />
                        )}
                        <span className="truncate">
                          {m.player1?.name || t("tournament.tbd", "TBD")}
                        </span>
                      </div>
                      <span className="font-mono text-xs">{m.player1?.score ?? "-"}</span>
                    </div>

                    <div className="h-px bg-slate-700/60 my-1" />

                    {/* Player 2 */}
                    <div
                      className={`flex items-center justify-between text-sm py-1 px-1.5 rounded ${
                        p2Winner ? "bg-green-950/40 text-green-400 font-bold" : "text-slate-200"
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        {m.player2?.seed !== undefined && (
                          <span className="text-[10px] font-mono text-slate-400 bg-slate-700 px-1 rounded">
                            {m.player2.seed}
                          </span>
                        )}
                        {m.player2?.avatar && (
                          <img
                            src={m.player2.avatar}
                            alt=""
                            className="w-5 h-5 rounded-full object-cover"
                          />
                        )}
                        <span className="truncate">
                          {m.player2?.name || t("tournament.tbd", "TBD")}
                        </span>
                      </div>
                      <span className="font-mono text-xs">{m.player2?.score ?? "-"}</span>
                    </div>

                    {/* Spectate CTA */}
                    {m.gameCode && (
                      <div className="mt-2 text-center text-xs text-amber-400 font-semibold hover:underline">
                        {t("tournament.spectateGame", "Watch /game/:code")}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default TournamentBracketTree;
