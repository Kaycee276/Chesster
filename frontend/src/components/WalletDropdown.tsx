import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useWalletStore, type WalletType } from "../store/walletStore";
import { useGameStore } from "../store/gameStore";
import { useToastStore } from "../store/toastStore";
import { ChevronDown, LogOut, RefreshCw, UserRound, Wallet, Gift } from "lucide-react";
import { Link } from "react-router-dom";
import { rpc } from "@stellar/stellar-sdk";

const RPC_URL = import.meta.env.VITE_STELLAR_RPC_URL || "https://soroban-testnet.stellar.org";
const server = new rpc.Server(RPC_URL);

const WALLET_OPTIONS: { type: WalletType; label: string; hint: string }[] = [
  { type: "freighter", label: "Freighter", hint: "Official Stellar wallet" },
  { type: "xbull", label: "xBull", hint: "xBull browser extension" },
  { type: "albedo", label: "Albedo", hint: "Albedo web signer" },
  { type: "rabet", label: "Rabet", hint: "Rabet browser extension" },
];

export default function WalletDropdown() {
  const { address, walletType, connectWith, disconnect } = useWalletStore();
  const isStreamerMode = useGameStore((s) => s.isStreamerMode);
  const { addToast } = useToastStore();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [connecting, setConnecting] = useState<WalletType | null>(null);
  const [balance, setBalance] = useState<string>("0");
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!address) {
      setBalance("0");
      return;
    }
    server.getAccount(address).then((acc) => {
      const native = acc.balances.find((b) => b.asset_type === "native");
      if (native) setBalance(parseFloat(native.balance).toFixed(2));
    }).catch(() => {
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

  const handleConnect = async (type: WalletType) => {
    setConnecting(type);
    try {
      await connectWith(type);
      setIsOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast(`Failed to connect ${type}: ${msg}`, "error");
    } finally {
      setConnecting(null);
    }
  };

  const displayBalance = isStreamerMode ? "•••• XLM" : `${balance} XLM`;
  const displayAddress = isStreamerMode && address ? `${address.slice(0, 4)}...${address.slice(-4)}` : address;

  // Not connected — show wallet picker button
  if (!address) {
    return (
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 text-sm bg-(--bg-secondary) hover:bg-(--bg-tertiary) px-3 py-1.5 rounded-lg border border-(--border) transition-colors"
        >
          <Wallet size={14} />
          Connect Wallet
          <ChevronDown size={14} className={`transition-transform ${isOpen ? "rotate-180" : ""}`} />
        </button>

        {isOpen && (
          <div className="absolute right-0 mt-2 w-52 bg-(--bg-secondary) border border-(--border) rounded-xl shadow-xl overflow-hidden z-50">
            <div className="p-1.5 flex flex-col gap-0.5">
              {WALLET_OPTIONS.map(({ type, label, hint }) => (
                <button
                  key={type}
                  onClick={() => handleConnect(type)}
                  disabled={connecting !== null}
                  className="flex flex-col items-start w-full px-3 py-2 text-sm text-(--text-secondary) hover:text-(--text) hover:bg-(--bg-tertiary) rounded-lg transition-colors disabled:opacity-50"
                >
                  <span className="font-medium">
                    {connecting === type ? "Connecting…" : label}
                  </span>
                  <span className="text-[11px] text-(--text-tertiary)">{hint}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Connected — show address + disconnect
  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 text-sm font-mono bg-(--bg-secondary) hover:bg-(--bg-tertiary) px-3 py-1.5 rounded-lg border border-(--border) transition-colors"
      >
        {walletType && <span className="text-[10px] text-(--text-tertiary) font-sans capitalize">{walletType}</span>}
        <span className="text-xs text-(--text-secondary)">{displayBalance}</span>
        <span>{displayAddress}</span>
        <ChevronDown size={14} className={`transition-transform ${isOpen ? "rotate-180" : ""}`} />
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
