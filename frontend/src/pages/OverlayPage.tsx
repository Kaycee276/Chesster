import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useGameStore } from "../store/gameStore";
import ChessBoard from "../components/ChessBoard";
import { api } from "../api/gameApi";
import { socketService } from "../api/socket";

export default function OverlayPage() {
	const { gameCode } = useParams<{ gameCode: string }>();
	const updateGameState = useGameStore((s) => s.updateGameState);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		if (!gameCode) return;
		// Force streamer mode for overlay
		useGameStore.setState({ isStreamerMode: true, gameCode });

		api.getGame(gameCode)
			.then((res) => {
				if (res.success && res.data) {
					updateGameState(res.data);
				}
			})
			.finally(() => setLoading(false));

		socketService.connect();
		socketService.joinGame(gameCode);
		socketService.onGameUpdate((data) => {
			updateGameState(data);
		});

		return () => {
			socketService.offGameUpdate();
			socketService.leaveGame(gameCode);
			socketService.disconnect();
		};
	}, [gameCode, updateGameState]);

	if (loading) {
		return (
			<div className="h-screen w-screen flex items-center justify-center bg-transparent text-white font-mono text-xl">
				Loading Stream Overlay...
			</div>
		);
	}

	return (
		<div className="h-screen w-screen flex flex-col items-center justify-center bg-transparent overflow-hidden p-2">
			<div className="w-full max-w-2xl aspect-square">
				<ChessBoard />
			</div>
		</div>
	);
}
