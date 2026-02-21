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

const networks: [AppKitNetwork, ...AppKitNetwork[]] = [
	sepolia as AppKitNetwork,
];

const metadata = {
	name: "Chesster",
	description:
		"A decentralized chess game built with React, Socket.IO, and Supabase. Play against friends or strangers, with on-chain move validation and game state management.",
	url: "https://chesster-lovat.vercel.app",
	icons: ["https://chesster-lovat.vercel.app/favicon.ico"],
};

const ethersAdapter = new EthersAdapter();

const App = () => {
	return (
		<AppKitProvider
			adapters={[ethersAdapter]}
			networks={networks}
			projectId={projectId}
			metadata={metadata}
			// includeWalletIds={[
			// 	"c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96",
			// ]}
			enableWallets={true}
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
