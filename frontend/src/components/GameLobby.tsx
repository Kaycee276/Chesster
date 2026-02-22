import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGameStore } from "../store/gameStore";
import { useToastStore } from "../store/toastStore";
import { AppKitButton, useAppKitAccount } from "@reown/appkit/react";

export default function GameLobby() {
	const [gameCode, setGameCode] = useState("");
	const [loading, setLoading] = useState(false);
	const [joining, setJoining] = useState(false);
	const { createGame, joinGame } = useGameStore();
	const { addToast, removeToast } = useToastStore();
	const navigate = useNavigate();
	const { address, isConnected } = useAppKitAccount();

	const handleCreateGame = async () => {
		if (!isConnected || !address) {
			addToast("Please connect your wallet first", "error");
			return;
		}
		setLoading(true);
		const toastId = addToast("Creating game...", "loading");
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
		} finally {
			removeToast(toastId);
			setLoading(false);
		}
	};

	const handleJoinGame = async () => {
		if (!isConnected || !address) {
			addToast("Please connect your wallet first", "error");
			return;
		}
		if (!gameCode) return;
		setJoining(true);
		const toastId = addToast("Joining game...", "loading");
		try {
			await joinGame(gameCode, "black", address);
			navigate(`/${gameCode}`);
		} catch (error: unknown) {
			if (error instanceof Error) {
				addToast(error.message);
			} else {
				addToast("Something went wrong");
			}
		} finally {
			removeToast(toastId);
			setJoining(false);
		}
	};

	return (
		<div className="h-svh w-screen overflow-hidden flex flex-col items-center justify-center bg-(--bg) p-4 gap-6">
			{/* Wallet button */}
			<div className="absolute top-4 right-4">
				<AppKitButton />
			</div>

			{/* Logo */}
			<div className="flex flex-col items-center gap-2 text-center">
				<h1 className="text-6xl font-bold tracking-tight">Chesster</h1>
				<p className="text-(--text-secondary) text-sm">
					{isConnected
						? "Ready to play — create or join a game"
						: "Connect your wallet to play on-chain chess"}
				</p>
			</div>

			{/* Actions */}
			<div className="flex flex-col gap-3 w-full max-w-xs">
				<button
					onClick={handleCreateGame}
					disabled={loading || !isConnected}
					className="w-full px-6 py-3.5 text-base font-bold bg-(--accent-dark) hover:bg-(--accent-primary) disabled:opacity-40 disabled:cursor-not-allowed transition-all rounded-2xl shadow-lg active:scale-[0.98]"
				>
					{loading ? "Creating…" : "Create New Game"}
				</button>

				<div className="flex items-center gap-3 text-xs text-(--text-tertiary)">
					<div className="flex-1 h-px bg-(--border)" />
					<span>or join with a code</span>
					<div className="flex-1 h-px bg-(--border)" />
				</div>

				<input
					type="text"
					placeholder="Enter game code"
					value={gameCode}
					onChange={(e) => setGameCode(e.target.value.toUpperCase())}
					onKeyDown={(e) => e.key === "Enter" && handleJoinGame()}
					maxLength={10}
					className="w-full px-4 py-3 text-base border border-(--border) rounded-xl text-center uppercase outline-none focus:ring-2 focus:ring-(--accent-primary) bg-(--bg-secondary) text-(--text) placeholder:text-(--text-tertiary) transition-all tracking-widest font-mono"
				/>
				<button
					onClick={handleJoinGame}
					disabled={!gameCode || joining || !isConnected}
					className="w-full px-6 py-3.5 text-base font-bold bg-(--bg-tertiary) hover:bg-(--bg-secondary) border border-(--border) disabled:opacity-40 disabled:cursor-not-allowed transition-all rounded-2xl active:scale-[0.98]"
				>
					Join Game
				</button>
			</div>
		</div>
	);
}
