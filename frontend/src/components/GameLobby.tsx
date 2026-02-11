import { useState } from "react";
import { useGameStore } from "../store/gameStore";
import { useToastStore } from "../store/toastStore";

export default function GameLobby() {
	const [gameCode, setGameCode] = useState("");
	const [loading, setLoading] = useState(false);
	const { createGame, joinGame } = useGameStore();
	const { addToast } = useToastStore();

	const handleCreateGame = async () => {
		setLoading(true);
		try {
			await createGame();
		} catch (error: unknown) {
			if (error instanceof Error) {
				addToast(error.message);
			} else {
				addToast("Something went wrong");
			}
		}
		setLoading(false);
	};

	const handleJoinGame = async (color: "white" | "black") => {
		if (!gameCode) return;
		setLoading(true);
		try {
			await joinGame(gameCode, color);
		} catch (error: unknown) {
			if (error instanceof Error) {
				addToast(error.message);
			} else {
				addToast("Something went wrong");
			}
		}
		setLoading(false);
	};

	return (
		<div className="flex flex-col items-center justify-center min-h-screen gap-8">
			<h1 className="text-6xl font-bold ">Chesster</h1>
			<div className="flex flex-col gap-5 w-80">
				<button
					onClick={handleCreateGame}
					disabled={loading}
					className="px-6 py-3 text-lg bg-(--accent-dark) hover:bg-(--accent-primary) disabled:bg-gray-400 transition-colors"
				>
					Create New Game
				</button>
				<div className="flex flex-col gap-3">
					<input
						type="text"
						placeholder="Enter game code"
						value={gameCode}
						onChange={(e) => setGameCode(e.target.value.toUpperCase())}
						maxLength={10}
						className="px-4 py-3 text-lg border rounded text-center uppercase outline-none"
					/>
					<div className="flex gap-3">
						<button
							onClick={() => handleJoinGame("white")}
							disabled={!gameCode || loading}
							className="flex-1 px-3 py-1 text-lg bg-(--accent-dark) hover:bg-(--accent-primary) disabled:bg-gray-400 transition-colors"
						>
							Join as White
						</button>
						<button
							onClick={() => handleJoinGame("black")}
							disabled={!gameCode || loading}
							className="flex-1 px-3 py-1 text-lg bg-(--accent-dark) hover:bg-(--accent-primary) disabled:bg-gray-400 transition-colors"
						>
							Join as Black
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
