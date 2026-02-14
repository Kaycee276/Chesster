import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useGameStore } from "../store/gameStore";
import { useToastStore } from "../store/toastStore";
import ChessBoard from "../components/ChessBoard";

export default function GamePage() {
	const { gameCode } = useParams<{ gameCode: string }>();
	const navigate = useNavigate();
	const {
		rejoinGame,
		gameCode: storedGameCode,
		playerColor,
		joinGame,
	} = useGameStore();
	const { addToast } = useToastStore();
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		if (!gameCode) {
			navigate("/");
			return;
		}

		// If player is already in this game, rejoin
		if (storedGameCode === gameCode && playerColor) {
			rejoinGame(gameCode);
		}
		// Otherwise, player needs to choose a color
	}, [gameCode, storedGameCode, playerColor, rejoinGame, navigate]);

	const handleJoinColor = async (color: "white" | "black") => {
		if (!gameCode) return;
		setLoading(true);
		try {
			await joinGame(gameCode, color);
		} catch (error: unknown) {
			if (error instanceof Error) {
				addToast(error.message, "error");
			} else {
				addToast("Something went wrong", "error");
			}
			setLoading(false);
		}
	};

	// If already a player in this game, show board
	if (storedGameCode === gameCode && playerColor) {
		return <ChessBoard />;
	}

	// Show color selection if visiting game URL without being a player
	return (
		<div className="flex flex-col items-center justify-center min-h-screen gap-8">
			<h2 className="text-4xl font-bold">Join Game {gameCode}</h2>
			<div className="flex gap-4">
				<button
					onClick={() => handleJoinColor("white")}
					disabled={loading}
					className="px-6 py-3 text-lg bg-white text-black hover:bg-gray-200 disabled:bg-gray-400 transition-colors rounded-lg font-bold"
				>
					Play as White
				</button>
				<button
					onClick={() => handleJoinColor("black")}
					disabled={loading}
					className="px-6 py-3 text-lg bg-black text-white hover:bg-gray-800 disabled:bg-gray-400 transition-colors rounded-lg font-bold"
				>
					Play as Black
				</button>
			</div>
		</div>
	);
}
