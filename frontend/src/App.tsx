import { AppKitProvider } from "@reown/appkit/react";
import { EthersAdapter } from "@reown/appkit-adapter-ethers";
import { sepolia } from "@reown/appkit/networks";
import type { AppKitNetwork } from "@reown/appkit/networks";

import { BrowserRouter, Routes, Route } from "react-router-dom";
import GameLobby from "./components/GameLobby";
import GamePage from "./pages/GamePage";
import Toast from "./components/Toast";

const projectId = import.meta.env.VITE_PROJECT_ID;
if (!projectId) {
	throw new Error("VITE_PROJECT_ID is not set in .env");
}

// 2. Set the networks
const networks: [AppKitNetwork, ...AppKitNetwork[]] = [
	sepolia as AppKitNetwork,
];

const metadata = {
	name: "Chesster",
	description:
		"Chesster is a chess game with on-chain move verification and rewards.",
	url: "https://chesster-lovat.vercel.app",
	icons: ["https://chesster-lovat.vercel.app/favicon.ico"],
};

const App = () => {
	return (
		<AppKitProvider
			adapters={[new EthersAdapter()]}
			networks={networks}
			projectId={projectId}
			metadata={metadata}
			features={{
				analytics: true,
			}}
			themeVariables={{
				"--w3m-accent": "#b91c1c",
			}}
		>
			<BrowserRouter>
				<Toast />
				<Routes>
					<Route path="/" element={<GameLobby />} />
					<Route path="/:gameCode" element={<GamePage />} />
				</Routes>
			</BrowserRouter>
		</AppKitProvider>
	);
};

export default App;
