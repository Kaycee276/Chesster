import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import GameLobby from "./components/GameLobby";
import GamePage from "./pages/GamePage";
import SpectatorPage from "./pages/SpectatorPage";
import TournamentPage from "./pages/TournamentPage";
import ReferralPage from "./pages/ReferralPage";
import ProfilePage from "./pages/ProfilePage";
import TournamentBracketPage from "./pages/TournamentBracketPage";
import AnalysisPage from "./pages/AnalysisPage";
import LeaderboardPage from "./pages/LeaderboardPage";
import Toast from "./components/Toast";
import ThemeSelector from "./components/ThemeSelector";
import NetworkBanner from "./components/NetworkBanner";
import { useWalletStore } from "./store/walletStore";
import { useThemeStore, applyColorMode } from "./store/themeStore";

function PrivateRoute({ element }: { element: React.ReactNode }) {
	const { isConnected } = useWalletStore();
	return isConnected ? element : <Navigate to="/" replace />;
}

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
			<NetworkBanner />
			<Toast />
			<Routes>
				<Route path="/" element={<GameLobby />} />
				<Route path="/tournaments" element={<TournamentPage />} />
				<Route path="/referrals" element={<PrivateRoute element={<ReferralPage />} />} />
				<Route path="/profile/:address" element={<ProfilePage />} />
				<Route
					path="/tournaments/:tournamentId/bracket"
					element={<TournamentBracketPage />}
				/>
				<Route path="/analysis" element={<AnalysisPage />} />
				<Route path="/leaderboard" element={<LeaderboardPage />} />
				<Route path="/:gameCode" element={<GamePage />} />
				<Route path="/spectate/:gameCode" element={<SpectatorPage />} />
			</Routes>
			<ThemeSelector />
		</BrowserRouter>
	);
};

export default App;
