import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGameStore } from "../store/gameStore";
import { useToastStore } from "../store/toastStore";
import { AppKitButton, useAppKitAccount } from "@reown/appkit/react";

export default function GameLobby() {
	const [gameCode, setGameCode] = useState("");
	const [loading, setLoading] = useState(false);
	const { createGame, joinGame } = useGameStore();
	const { addToast } = useToastStore();
	const navigate = useNavigate();
	const { address, isConnected } = useAppKitAccount();

	const handleCreateGame = async () => {
		if (!isConnected || !address) {
			addToast("Please connect your wallet first", "error");
			return;
		}
		setLoading(true);
		try {
			await createGame(address);
			const code = useGameStore.getState().gameCode;
			if (code) navigate(`/${code}`);
		} catch (error: unknown) {
			if (error instanceof Error) {
				addToast(error.message);
			} else {
				addToast("Something went wrong");
			}
		}
		setLoading(false);
	};

	const handleJoinGame = async () => {
		if (!isConnected || !address) {
			addToast("Please connect your wallet first", "error");
			return;
		}
		if (!gameCode) return;
		setLoading(true);
		try {
			await joinGame(gameCode, "black", address);
			navigate(`/${gameCode}`);
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
			<div className="absolute top-6 right-6">
				<AppKitButton />
			</div>
			<h1 className="text-6xl font-bold ">Chesster</h1>
			{!isConnected && (
				<p className="text-gray-400 text-sm">Connect your wallet to play</p>
			)}
			<div className="flex flex-col gap-5 w-80">
				<button
					onClick={handleCreateGame}
					disabled={loading || !isConnected}
					className="px-6 py-3 text-lg bg-(--accent-dark) hover:bg-(--accent-primary) disabled:bg-gray-400 transition-colors rounded-2xl"
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
					<button
						onClick={handleJoinGame}
						disabled={!gameCode || loading || !isConnected}
						className="px-3 py-3 text-lg bg-(--accent-dark) hover:bg-(--accent-primary) disabled:bg-gray-400 transition-colors rounded-xl"
					>
						Join Game
					</button>
				</div>
			</div>
		</div>
	);
}
