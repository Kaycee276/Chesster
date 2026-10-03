import { useCallback, useEffect, useRef, useState } from "react";
import { getNetworkDetails } from "@stellar/freighter-api";
import { WifiOff, AlertTriangle, X } from "lucide-react";
import { useWalletStore } from "../store/walletStore";
import { useToastStore } from "../store/toastStore";
import { describeNetwork, isNetworkMismatch } from "../utils/networkUtils";

const TARGET_PASSPHRASE =
	import.meta.env.VITE_STELLAR_NETWORK_PASSPHRASE ||
	"Test SDF Network ; September 2015";

const TARGET_NETWORK_LABEL = describeNetwork(TARGET_PASSPHRASE);

// Freighter re-checks its own network state on every call, but doesn't push
// change events — poll while a wallet is connected so a mismatch clears
// automatically once the user switches inside the extension.
const WALLET_POLL_MS = 5000;

export default function NetworkBanner() {
	const isWalletConnected = useWalletStore((s) => s.isConnected);
	const addToast = useToastStore((s) => s.addToast);

	const [isOffline, setIsOffline] = useState(() => !navigator.onLine);
	const [offlineDismissed, setOfflineDismissed] = useState(false);
	const [walletNetworkLabel, setWalletNetworkLabel] = useState<string | null>(null);
	const [networkMismatch, setNetworkMismatch] = useState(false);
	const [mismatchDismissed, setMismatchDismissed] = useState(false);

	useEffect(() => {
		const handleOnline = () => {
			setIsOffline(false);
			setOfflineDismissed(false);
		};
		const handleOffline = () => setIsOffline(true);

		window.addEventListener("online", handleOnline);
		window.addEventListener("offline", handleOffline);
		return () => {
			window.removeEventListener("online", handleOnline);
			window.removeEventListener("offline", handleOffline);
		};
	}, []);

	// Tracks the previous mismatch result so a dismissed banner only
	// reappears when the mismatch newly occurs, not on every poll tick.
	const wasMismatchedRef = useRef(false);

	const checkWalletNetwork = useCallback(async () => {
		if (!isWalletConnected) {
			setNetworkMismatch(false);
			wasMismatchedRef.current = false;
			return;
		}
		try {
			const details = await getNetworkDetails();
			if (details.error || !details.networkPassphrase) {
				setNetworkMismatch(false);
				wasMismatchedRef.current = false;
				return;
			}
			setWalletNetworkLabel(describeNetwork(details.networkPassphrase));
			const mismatch = isNetworkMismatch(details.networkPassphrase, TARGET_PASSPHRASE);
			setNetworkMismatch(mismatch);
			if (mismatch && !wasMismatchedRef.current) setMismatchDismissed(false);
			wasMismatchedRef.current = mismatch;
		} catch {
			// Wallet extension not installed or call rejected — nothing to warn about.
			setNetworkMismatch(false);
			wasMismatchedRef.current = false;
		}
	}, [isWalletConnected]);

	useEffect(() => {
		// Async result, not a synchronous setState call — checking the wallet's
		// network on mount/reconnect (then polling) is the intended pattern here.
		checkWalletNetwork(); // eslint-disable-line react-hooks/set-state-in-effect
		if (!isWalletConnected) return;
		const interval = setInterval(checkWalletNetwork, WALLET_POLL_MS);
		return () => clearInterval(interval);
	}, [isWalletConnected, checkWalletNetwork]);

	const handleSwitchRequest = () => {
		addToast(
			`Open your wallet extension and switch to ${TARGET_NETWORK_LABEL} — Chesster can't switch networks for you.`,
			"info",
		);
	};

	if (isOffline && !offlineDismissed) {
		return (
			<div className="flex items-center justify-center gap-2 bg-red-600 text-white text-center py-2 px-4 text-sm font-semibold">
				<WifiOff size={14} className="shrink-0" />
				<span>Offline. Please check your internet connection.</span>
				<button
					onClick={() => setOfflineDismissed(true)}
					className="ml-1 shrink-0 opacity-80 hover:opacity-100 transition-opacity"
					aria-label="Dismiss"
				>
					<X size={14} />
				</button>
			</div>
		);
	}

	if (networkMismatch && !mismatchDismissed) {
		return (
			<div className="flex items-center justify-center gap-2 bg-amber-600 text-white text-center py-2 px-4 text-sm font-semibold flex-wrap">
				<AlertTriangle size={14} className="shrink-0" />
				<span>
					Wallet network mismatch
					{walletNetworkLabel ? ` (connected to ${walletNetworkLabel})` : ""} — switch
					your wallet to {TARGET_NETWORK_LABEL}.
				</span>
				<button
					onClick={handleSwitchRequest}
					className="underline hover:no-underline shrink-0"
				>
					How?
				</button>
				<button
					onClick={() => setMismatchDismissed(true)}
					className="ml-1 shrink-0 opacity-80 hover:opacity-100 transition-opacity"
					aria-label="Dismiss"
				>
					<X size={14} />
				</button>
			</div>
		);
	}

	return null;
}
