import { useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import GameLobby from "./components/GameLobby";
import GamePage from "./pages/GamePage";
import SpectatorPage from "./pages/SpectatorPage";
import Toast from "./components/Toast";
import ThemeSelector from "./components/ThemeSelector";
import { useWalletStore } from "./store/walletStore";

const App = () => {
	const { checkConnection } = useWalletStore();

	useEffect(() => {
		checkConnection();
	}, [checkConnection]);

	return (
		<BrowserRouter>
			<Toast />
			<Routes>
				<Route path="/" element={<GameLobby />} />
				<Route path="/:gameCode" element={<GamePage />} />
				<Route path="/spectate/:gameCode" element={<SpectatorPage />} />
			</Routes>
			<ThemeSelector />
		</BrowserRouter>
	);
};

export default App;
