import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import GameLobby from "./components/GameLobby";
import GamePage from "./pages/GamePage";
import SpectatorPage from "./pages/SpectatorPage";
import TournamentPage from "./pages/TournamentPage";
import OfflineGameViewer from "./components/OfflineGameViewer";
import PuzzlePage from "./pages/PuzzlePage";
import GameSettings from "./components/GameSettings";
import ReferralPage from "./pages/ReferralPage";
import ProfilePage from "./pages/ProfilePage";
import TournamentBracketPage from "./pages/TournamentBracketPage";
import AnalysisPage from "./pages/AnalysisPage";
import LeaderboardPage from "./pages/LeaderboardPage";
import StatusPage from "./pages/StatusPage";
import OverlayPage from "./pages/OverlayPage";

import PwaControls from "./components/PwaControls";
import { useOfflineDetection } from "./hooks/useOfflineDetection";
import { offlineRedirect } from "./utils/pwaRoutes";
import Toast from "./components/Toast";
import ThemeSelector from "./components/ThemeSelector";
import NetworkBanner from "./components/NetworkBanner";
import { useWalletStore } from "./store/walletStore";
import { useThemeStore, applyColorMode } from "./store/themeStore";

const OfflineBotGame = lazy(() => import("./components/OfflineBotGame"));

function PrivateRoute({ element }: { element: React.ReactNode }) {
	const { isConnected } = useWalletStore();
	return isConnected ? element : <Navigate to="/" replace />;
}

function OfflineRouteBoundary({ children }: { children: React.ReactNode }) {
	const { pathname } = useLocation();
	const redirect = offlineRedirect(pathname, useOfflineDetection());
	return redirect ? <Navigate to={redirect} replace /> : children;
}

function AppChrome() {
	const { pathname } = useLocation();
	const offline = useOfflineDetection();
	if (pathname.startsWith("/overlay/")) return null;
	return (
		<>
			{!offline && <NetworkBanner />}
			<Toast />
			<ThemeSelector />
			<GameSettings />
			<PwaControls />
		</>
	);
}

const App = () => {
	const { checkConnection } = useWalletStore();
	const colorMode = useThemeStore((s) => s.colorMode);
	const offline = useOfflineDetection();

	useEffect(() => {
		if (!offline) checkConnection();
	}, [checkConnection, offline]);

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
			<AppChrome />
			<OfflineRouteBoundary>
				<Routes>
					<Route path="/" element={<GameLobby />} />
					<Route path="/tournaments" element={<TournamentPage />} />
					<Route path="/puzzles" element={<PuzzlePage />} />
					<Route path="/referrals" element={<PrivateRoute element={<ReferralPage />} />} />
					<Route path="/profile/:address" element={<ProfilePage />} />
					<Route
						path="/tournaments/:tournamentId/bracket"
						element={<TournamentBracketPage />}
					/>
					<Route path="/offline-games" element={<OfflineGameViewer />} />
					<Route path="/offline-play" element={
						<Suspense fallback={<p role="status">Loading offline play…</p>}>
							<OfflineBotGame />
						</Suspense>
					} />
					<Route path="/analysis" element={<AnalysisPage />} />
					<Route path="/leaderboard" element={<LeaderboardPage />} />
					<Route path="/status" element={<StatusPage />} />
					<Route path="/overlay/:code" element={<OverlayPage />} />
					<Route path="/overlay/game/:gameCode" element={<OverlayPage />} />
					<Route path="/:gameCode" element={<GamePage />} />
					<Route path="/spectate/:gameCode" element={<SpectatorPage />} />
				</Routes>
			</OfflineRouteBoundary>
		</BrowserRouter>
	);
};

export default App;
