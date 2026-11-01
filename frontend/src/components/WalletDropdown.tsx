import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useWalletStore } from "../store/walletStore";
import { useGameStore } from "../store/gameStore";
import { useToastStore } from "../store/toastStore";
import { ChevronDown, LogOut, RefreshCw, UserRound, Wallet, Gift } from "lucide-react";
import { Link } from "react-router-dom";
import { fetchAccountBalances } from "../services/stellarService";

export default function WalletDropdown() {
  const { address, walletType, connectWith, disconnect } = useWalletStore();
  const isStreamerMode = useGameStore((s) => s.isStreamerMode);
  const { addToast } = useToastStore();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [balance, setBalance] = useState<string>("0");
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!address) return;
    fetchAccountBalances(address)
      .then((balances) => {
        const native = balances.find((b) => b.assetCode === "XLM");
        if (native) setBalance(parseFloat(native.balance).toFixed(2));
      })
      .catch(() => {
        setBalance("0");
      });
  }, [address]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      await connectWith("stellar-wallets-kit");
      setIsOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast(`Failed to connect wallet: ${msg}`, "error");
    } finally {
      setConnecting(false);
    }
  };

  const shortenAddr = (addr: string) => `${addr.slice(0, 4)}…${addr.slice(-4)}`;
  const activeBalance = address ? balance : "0";
  const displayBalance = isStreamerMode ? "•••• XLM" : `${activeBalance} XLM`;
  const displayAddress = isStreamerMode ? "••••••••" : address ? shortenAddr(address) : "";

  // Not connected — show wallet picker button
  if (!address) {
    return (
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={handleConnect}
          disabled={connecting}
          aria-label={connecting ? "Connecting wallet" : "Connect wallet"}
          className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm bg-(--bg-secondary) hover:bg-(--bg-tertiary) px-2.5 sm:px-3 py-1.5 rounded-lg border border-(--border) transition-colors shrink-0"
        >
          <Wallet size={14} className="shrink-0" />
          <span>
            <span className="hidden xs:inline">{connecting ? "Connecting…" : "Connect "}</span>Wallet
          </span>
        </button>
      </div>
    );
  }

  // Connected — show address + disconnect
  return (
    <div className="relative shrink-0" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm font-mono bg-(--bg-secondary) hover:bg-(--bg-tertiary) px-2.5 sm:px-3 py-1.5 rounded-lg border border-(--border) transition-colors shrink-0"
      >
        {walletType && (
          <span className="hidden md:inline text-[10px] text-(--text-tertiary) font-sans capitalize">
            {walletType}
          </span>
        )}
        <span className="hidden sm:inline text-xs text-(--text-secondary)">{displayBalance}</span>
        <span>{displayAddress}</span>
        <ChevronDown
          size={14}
          className={`shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-48 bg-(--bg-secondary) border border-(--border) rounded-xl shadow-xl overflow-hidden z-50">
          <div className="p-2 flex flex-col gap-1">
            <Link
              to={`/profile/${encodeURIComponent(address)}`}
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm text-(--text-secondary) hover:text-(--text) hover:bg-(--bg-tertiary) rounded-lg transition-colors text-left"
            >
              <UserRound size={14} />
              My Profile
            </Link>
            <button
              onClick={() => {
                navigate("/referrals");
                setIsOpen(false);
              }}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm text-(--text-secondary) hover:text-(--text) hover:bg-(--bg-tertiary) rounded-lg transition-colors text-left"
            >
              <Gift size={14} />
              Referrals
            </button>
            <button
              onClick={() => {
                addToast("Please open the wallet extension to switch accounts", "info");
                setIsOpen(false);
              }}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm text-(--text-secondary) hover:text-(--text) hover:bg-(--bg-tertiary) rounded-lg transition-colors text-left"
            >
              <RefreshCw size={14} />
              Change Account
            </button>
            <button
              onClick={() => {
                disconnect();
                setIsOpen(false);
              }}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors text-left"
            >
              <LogOut size={14} />
              Disconnect
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
