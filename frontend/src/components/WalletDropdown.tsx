import { useState, useRef, useEffect } from "react";
import { useWalletStore, type WalletType } from "../store/walletStore";
import { useToastStore } from "../store/toastStore";
import { ChevronDown, LogOut, RefreshCw, Wallet } from "lucide-react";

const WALLET_OPTIONS: { type: WalletType; label: string; hint: string }[] = [
  { type: "freighter", label: "Freighter", hint: "Official Stellar wallet" },
  { type: "xbull", label: "xBull", hint: "xBull browser extension" },
  { type: "albedo", label: "Albedo", hint: "Albedo web signer" },
  { type: "rabet", label: "Rabet", hint: "Rabet browser extension" },
];

export default function WalletDropdown() {
  const { address, walletType, connectWith, disconnect } = useWalletStore();
  const { addToast } = useToastStore();
  const [isOpen, setIsOpen] = useState(false);
  const [connecting, setConnecting] = useState<WalletType | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

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
        {address.slice(0, 4)}...{address.slice(-4)}
        <ChevronDown size={14} className={`transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-48 bg-(--bg-secondary) border border-(--border) rounded-xl shadow-xl overflow-hidden z-50">
          <div className="p-2 flex flex-col gap-1">
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
