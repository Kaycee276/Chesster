import { useCallback, useEffect, useRef, useState } from "react";
import { WifiOff, AlertTriangle, X, Wifi } from "lucide-react";
import { useWalletStore } from "../store/walletStore";
import { useGameStore } from "../store/gameStore";
import { useToastStore } from "../store/toastStore";
import { describeNetwork, isNetworkMismatch } from "../utils/networkUtils";
import { socketService } from "../api/socket";
import { getWalletNetwork } from "../services/walletKit";

const TARGET_PASSPHRASE =
  import.meta.env.VITE_STELLAR_NETWORK_PASSPHRASE || "Test SDF Network ; September 2015";

const TARGET_NETWORK_LABEL = describeNetwork(TARGET_PASSPHRASE);

// Poll the selected provider so changes made inside a wallet are reflected.
const WALLET_POLL_MS = 5000;

export default function NetworkBanner() {
  const isWalletConnected = useWalletStore((s) => s.isConnected);
  const addToast = useToastStore((s) => s.addToast);

  // Socket connection state (Issue #401)
  const pingMs = useGameStore((s) => s.pingMs);
  const socketStatus = useGameStore((s) => s.socketStatus);
  const reconnectAttempts = useGameStore((s) => s.reconnectAttempts);

  const [isOffline, setIsOffline] = useState(() => !navigator.onLine);
  const [offlineDismissed, setOfflineDismissed] = useState(false);
  const [walletNetworkLabel, setWalletNetworkLabel] = useState<string | null>(null);
  const [networkMismatch, setNetworkMismatch] = useState(false);
  const [mismatchDismissed, setMismatchDismissed] = useState(false);
  const [reconnectCountdown, setReconnectCountdown] = useState(0);

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

  // Reconnection countdown timer (Issue #401)
  useEffect(() => {
    if (socketStatus === "reconnecting") {
      const backoffMs = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 30000);
      const timer = setTimeout(() => {
        setReconnectCountdown(Math.floor(backoffMs / 1000));
      }, 0);

      const interval = setInterval(() => {
        setReconnectCountdown((prev) => Math.max(0, prev - 1));
      }, 1000);

      return () => {
        clearTimeout(timer);
        clearInterval(interval);
      };
    }
  }, [socketStatus, reconnectAttempts]);

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
      const networkPassphrase = await getWalletNetwork();
      if (!networkPassphrase) {
        setNetworkMismatch(false);
        wasMismatchedRef.current = false;
        return;
      }
      setWalletNetworkLabel(describeNetwork(networkPassphrase));
      const mismatch = isNetworkMismatch(networkPassphrase, TARGET_PASSPHRASE);
      setNetworkMismatch(mismatch);
      if (mismatch && !wasMismatchedRef.current) setMismatchDismissed(false);
      wasMismatchedRef.current = mismatch;
    } catch {
      // Wallet is disconnected or the provider rejected the network query.
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
      "info"
    );
  };

  // Manual reconnect handler (Issue #401)
  const handleReconnect = () => {
    const socket = socketService.getSocket();
    if (socket) {
      socket.connect();
    }
  };

  // Latency color coding (Issue #401)
  const getLatencyColor = (ms: number) => {
    if (ms < 80) return "text-green-500";
    if (ms < 200) return "text-yellow-500";
    return "text-red-500";
  };

  const getLatencyDot = (ms: number) => {
    if (ms < 80) return "bg-green-500";
    if (ms < 200) return "bg-yellow-500";
    return "bg-red-500";
  };

  // Render latency badge when connected (Issue #401)
  if (socketStatus === "connected" && pingMs > 0) {
    return (
      <>
        <div className="fixed top-4 right-4 z-50 px-3 py-2 bg-gray-900 rounded-lg shadow-lg flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${getLatencyDot(pingMs)}`} />
          <Wifi size={14} className={getLatencyColor(pingMs)} />
          <span className={`text-sm font-mono ${getLatencyColor(pingMs)}`}>{pingMs}ms</span>
        </div>
        {/* Show wallet/offline banners below latency badge */}
        {renderBanners()}
      </>
    );
  }

  // Render reconnection banner (Issue #401)
  if (socketStatus === "reconnecting" || socketStatus === "disconnected") {
    return (
      <div className="hidden md:flex flex-col gap-2">
        <div className="flex items-center justify-center gap-2 bg-yellow-600 text-white text-center py-2 px-4 text-sm font-semibold">
          <div className="w-2 h-2 bg-yellow-300 rounded-full animate-pulse" />
          <span>
            {socketStatus === "reconnecting"
              ? `Reconnecting to match server (attempt ${reconnectAttempts})...`
              : "Connection lost"}
          </span>
          <button
            onClick={handleReconnect}
            className="px-3 py-1 bg-yellow-700 hover:bg-yellow-800 text-white rounded text-sm font-medium transition-colors"
          >
            Reconnect Now
          </button>
          {reconnectCountdown > 0 && (
            <span className="text-xs text-yellow-200">Next attempt in {reconnectCountdown}s</span>
          )}
        </div>
        {renderBanners()}
      </div>
    );
  }

  return renderBanners();

  function renderBanners() {
    if (isOffline && !offlineDismissed) {
      return (
        <div className="hidden md:flex items-center justify-center gap-2 bg-red-600 text-white text-center py-2 px-4 text-sm font-semibold">
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
        <div className="hidden md:flex items-center justify-center gap-2 bg-amber-600 text-white text-center py-2 px-4 text-sm font-semibold flex-wrap">
          <AlertTriangle size={14} className="shrink-0" />
          <span>
            Wallet network mismatch
            {walletNetworkLabel ? ` (connected to ${walletNetworkLabel})` : ""} — switch your wallet
            to {TARGET_NETWORK_LABEL}.
          </span>
          <button onClick={handleSwitchRequest} className="underline hover:no-underline shrink-0">
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
}
