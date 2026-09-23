import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
import GameLobby from "./components/GameLobby";
import GamePage from "./pages/GamePage";
import SpectatorPage from "./pages/SpectatorPage";
import Toast from "./components/Toast";
import ThemeSelector from "./components/ThemeSelector";
import { TournamentQueueModal } from "./components/TournamentQueueModal";
import { useWalletStore } from "./store/walletStore";
import { useThemeStore, applyColorMode } from "./store/themeStore";
import { socketService } from "./api/socket";
import type { MatchReadyEvent } from "./api/socket";

const AppContent = () => {
	const navigate = useNavigate();
	const [matchData, setMatchData] = useState<MatchReadyEvent | null>(null);

	useEffect(() => {
		socketService.connect();
		socketService.onTournamentMatchReady((data) => {
			setMatchData(data);
		});
		return () => {
			socketService.offTournamentMatchReady();
		};
	}, []);

	return (
		<>
			<Toast />
			<Routes>
				<Route path="/" element={<GameLobby />} />
				<Route path="/:gameCode" element={<GamePage />} />
				<Route path="/spectate/:gameCode" element={<SpectatorPage />} />
			</Routes>
			<ThemeSelector />
			{matchData && (
				<TournamentQueueModal
					matchData={matchData}
					onEnterMatch={(gameCode) => {
						setMatchData(null);
						navigate(`/${gameCode}`);
					}}
				/>
			)}
		</>
	);
};

const App = () => {
	const { checkConnection } = useWalletStore();
	const colorMode = useThemeStore((s) => s.colorMode);

	useEffect(() => {
		checkConnection();
	}, [checkConnection]);

	useEffect(() => {
		applyColorMode(colorMode);
		if (typeof window === "undefined" || !window.matchMedia) return;
		const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
		const handleChange = () => {
			if (useThemeStore.getState().colorMode === "system") {
				applyColorMode("system");
			}
		};
		mediaQuery.addEventListener("change", handleChange);
		return () => mediaQuery.removeEventListener("change", handleChange);
	}, [colorMode]);

	return (
		<BrowserRouter>
			<AppContent />
		</BrowserRouter>
	);
};

export default App;
