import { useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import GameLobby from "./components/GameLobby";
import GamePage from "./pages/GamePage";
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
			</Routes>
			<ThemeSelector />
		</BrowserRouter>
	);
};

export default App;
