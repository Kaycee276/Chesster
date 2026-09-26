import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Link } from "react-router-dom";
import { useWalletStore, type WalletType } from "../store/walletStore";
import { useToastStore } from "../store/toastStore";
import { fetchAccountBalances, type WalletBalance } from "../services/stellarService";
import {
  ChevronDown,
  LogOut,
  RefreshCw,
  UserRound,
  Wallet,
  Gift,
} from "lucide-react";

const WALLET_OPTIONS: { type: WalletType; label: string; hint: string }[] = [
  { type: "freighter", label: "Freighter", hint: "Official Stellar wallet" },
  { type: "xbull", label: "xBull", hint: "xBull browser extension" },
  { type: "albedo", label: "Albedo", hint: "Albedo web signer" },
  { type: "rabet", label: "Rabet", hint: "Rabet browser extension" },
];

// Trim trailing zeros but keep up to 4 decimal places for a compact display,
// e.g. "12.4550000" -> "12.455", "100.0000000" -> "100".
function formatBalance(raw: string): string {
  const num = Number(raw);
  if (!Number.isFinite(num)) return raw;
  return num.toFixed(4).replace(/\.?0+$/, "") || "0";
}

export default function WalletDropdown() {
  const { address, walletType, connectWith, disconnect } = useWalletStore();
  const { addToast } = useToastStore();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [connecting, setConnecting] = useState<WalletType | null>(null);
  const [balances, setBalances] = useState<WalletBalance[] | null>(null);
  // Starts true so the connected button doesn't briefly show a stale "0 XLM"
  // before the first balance fetch (triggered from an effect) resolves.
  const [balancesLoading, setBalancesLoading] = useState(true);
  const [balancesError, setBalancesError] = useState(false);
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

  // Fetches balances for `publicKey`. Deliberately built as a promise chain
  // (rather than setting `balancesLoading` synchronously up front) so this
  // can be called safely from an effect without triggering cascading
  // synchronous re-renders — see react-hooks/set-state-in-effect.
  const runBalancesFetch = (publicKey: string) => {
    fetchAccountBalances(publicKey)
      .then((data) => {
        setBalances(data);
        setBalancesError(false);
      })
      .catch(() => {
        setBalancesError(true);
        setBalances(null);
      })
      .finally(() => setBalancesLoading(false));
  };

  useEffect(() => {
    if (address) runBalancesFetch(address);
  }, [address]);

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

  const handleRefreshBalances = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!address) return;
    setBalancesLoading(true);
    runBalancesFetch(address);
  };

  const xlmBalance = balances?.find((b) => b.assetCode === "XLM");
  const otherBalances = balances?.filter((b) => b.assetCode !== "XLM") ?? [];

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

  // Connected — show address, XLM balance, and disconnect
  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 text-sm font-mono bg-(--bg-secondary) hover:bg-(--bg-tertiary) px-3 py-1.5 rounded-lg border border-(--border) transition-colors"
      >
        {walletType && <span className="text-[10px] text-(--text-tertiary) font-sans capitalize">{walletType}</span>}
        {address.slice(0, 4)}...{address.slice(-4)}
        <span className="text-(--text-tertiary) font-sans">&#183;</span>
        <span
          className="text-xs font-sans font-semibold text-(--accent-primary)"
          title={balancesError ? "Failed to load balance" : undefined}
        >
          {balancesLoading
            ? "…"
            : balancesError
              ? "—"
              : `${formatBalance(xlmBalance?.balance ?? "0")} XLM`}
        </span>
        <ChevronDown size={14} className={`transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-52 bg-(--bg-secondary) border border-(--border) rounded-xl shadow-xl overflow-hidden z-50">
          <div className="flex items-center justify-between px-3 py-2 border-b border-(--border)">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-(--text-tertiary)">
              Balances
            </span>
            <button
              onClick={handleRefreshBalances}
              disabled={balancesLoading}
              aria-label="Refresh balances"
              className="text-(--text-tertiary) hover:text-(--text) transition-colors disabled:opacity-50"
            >
              <RefreshCw size={12} className={balancesLoading ? "animate-spin" : ""} />
            </button>
          </div>
          <div className="px-3 py-2 flex flex-col gap-1 border-b border-(--border)">
            {balancesError ? (
              <span className="text-xs text-red-400">Couldn&apos;t load balances</span>
            ) : (
              <>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-(--text-secondary)">XLM</span>
                  <span className="font-mono font-semibold">
                    {balancesLoading ? "…" : formatBalance(xlmBalance?.balance ?? "0")}
                  </span>
                </div>
                {otherBalances.map((b, i) => (
                  <div key={`${b.assetCode}-${i}`} className="flex items-center justify-between text-xs">
                    <span className="text-(--text-secondary)">{b.assetCode}</span>
                    <span className="font-mono font-semibold">{formatBalance(b.balance)}</span>
                  </div>
                ))}
              </>
            )}
          </div>
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
                setBalances(null);
                setBalancesError(false);
                setBalancesLoading(true);
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
