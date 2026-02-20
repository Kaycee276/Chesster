import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useGameStore } from "../store/gameStore";
import { useToastStore } from "../store/toastStore";
import { useAppKitAccount, AppKitButton } from "@reown/appkit/react";
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
	const { address, isConnected } = useAppKitAccount();
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
	}, [gameCode, storedGameCode, playerColor, rejoinGame, navigate]);

	const handleJoinAsBlack = async () => {
		if (!gameCode) return;
		if (!isConnected || !address) {
			addToast("Please connect your wallet first", "error");
			return;
		}
		setLoading(true);
		try {
			await joinGame(gameCode, "black", address);
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

	// Show join prompt for the second player
	return (
		<div className="flex flex-col items-center justify-center min-h-screen gap-8">
			<div className="absolute top-6 right-6">
				<AppKitButton />
			</div>
			<h2 className="text-4xl font-bold">Join Game {gameCode}</h2>
			{!isConnected ? (
				<p className="text-gray-400 text-sm">Connect your wallet to join</p>
			) : (
				<button
					onClick={handleJoinAsBlack}
					disabled={loading}
					className="px-6 py-3 text-lg bg-black text-white hover:bg-gray-800 disabled:bg-gray-400 transition-colors rounded-lg font-bold"
				>
					{loading ? "Joining..." : "Play as Black"}
				</button>
			)}
		</div>
	);
}
