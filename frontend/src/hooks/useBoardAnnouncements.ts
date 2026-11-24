import { useEffect, useState } from "react";
import { useGameStore } from "../store/gameStore";
import { clockAnnouncement, narrateBoardMove, type BoardMove } from "../utils/boardA11y";

function moveKey(move: BoardMove | null | undefined): string {
  return move ? `${move.piece}:${move.from.join(",")}:${move.to.join(",")}` : "";
}

/** React to real game updates; identical polling responses do not repeat announcements. */
export function useBoardAnnouncements() {
  const [messages, setMessages] = useState({ move: "", clock: "" });
  useEffect(() => useGameStore.subscribe((state, previous) => {
    if (state.gameCode !== previous.gameCode) {
      setMessages({ move: "", clock: "" });
      return;
    }
    const move = state.lastMove;
    let moveMessage = "";
    if (move && moveKey(move) !== moveKey(previous.lastMove) && previous.board.length === 8) {
      const destination = previous.board[move.to[0]]?.[move.to[1]];
      const enPassant = move.piece.toLowerCase() === "p" &&
        move.from[1] !== move.to[1] && destination === ".";
      const capturedPiece = enPassant
        ? move.piece === move.piece.toUpperCase() ? "p" : "P"
        : destination && destination !== "." ? destination : undefined;
      const promotedPiece = state.board[move.to[0]]?.[move.to[1]];
      const promotion = move.piece.toLowerCase() === "p" &&
        (move.to[0] === 0 || move.to[0] === 7) && promotedPiece?.toLowerCase() !== "p"
        ? promotedPiece : undefined;
      moveMessage = narrateBoardMove(move, {
        capturedPiece, promotion, inCheck: state.inCheck,
        checkmate: state.status === "finished" && state.endReason === "checkmate",
      });
    }
    if (state.inCheck && !previous.inCheck && !moveMessage) {
      moveMessage = `Check. ${state.currentTurn} king is in check.`;
    }
    if (state.status === "finished" && previous.status !== "finished" && !moveMessage) {
      moveMessage = state.endReason === "checkmate" ? "Checkmate. Game over." :
        state.winner === "draw" ? "Game drawn." : `Game over. ${state.winner ?? "No player"} wins.`;
    }
    const clockMessage = state.status === "active" && state.currentTurn === previous.currentTurn
      ? clockAnnouncement(previous.secondsLeft, state.secondsLeft, state.currentTurn) : "";
    if (moveMessage || clockMessage) {
      setMessages(current => ({
        move: moveMessage || current.move,
        clock: clockMessage || current.clock,
      }));
    }
  }), []);
  return messages;
}
