import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Coins,
  Crown,
  RefreshCw,
  Search,
  Trophy,
  Users,
  Wallet,
} from "lucide-react";
import {
  fetchTournaments,
  joinTournament,
  type Tournament,
  type TournamentStatus,
} from "../api/tournamentApi";
import { useToastStore } from "../store/toastStore";
import { useWalletStore } from "../store/walletStore";
import WalletDropdown from "../components/WalletDropdown";

type TournamentFilter = "all" | "live" | "upcoming" | "past";

const FILTERS: { key: TournamentFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "live", label: "Live Now" },
  { key: "upcoming", label: "Upcoming" },
  { key: "past", label: "Completed" },
];

const EMPTY_MESSAGES: Record<TournamentFilter, string> = {
  all: "No tournaments have been created yet.",
  live: "No tournaments are running right now.",
  upcoming: "No upcoming tournaments are scheduled.",
  past: "No completed tournaments yet.",
};

const STATUS_LABELS: Record<TournamentStatus, string> = {
  open: "Registration Open",
  active: "Live Now",
  completed: "Completed",
  cancelled: "Cancelled",
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const formatXLM = (v: number) => {
  if (!Number.isFinite(v)) return "–";
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
};

const shortenAddress = (addr: string) => `${addr.slice(0, 4)}…${addr.slice(-4)}`;

function matchesFilter(t: Tournament, filter: TournamentFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "live":
      return t.status === "active";
    case "upcoming":
      return t.status === "open";
    case "past":
      return t.status === "completed" || t.status === "cancelled";
  }
}

function formatCountdown(startsAt: string, now: number): string {
  const diff = new Date(startsAt).getTime() - now;
  if (!Number.isFinite(diff)) return "";
  if (diff <= 0) return "Starting soon";
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff % 86_400_000) / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const s = Math.floor((diff % 60_000) / 1000);
  if (d > 0) return `Starts in ${d}d ${h}h`;
  if (h > 0) return `Starts in ${h}h ${m}m`;
  if (m > 0) return `Starts in ${m}m ${s}s`;
  return `Starts in ${s}s`;
}

// ── Spinner ───────────────────────────────────────────────────────────────────
function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg
      className="animate-spin shrink-0"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: TournamentStatus }) {
  if (status === "active") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-(--accent-dark)/20 px-2.5 py-1 text-xs font-semibold text-(--accent-primary)">
        <span className="h-1.5 w-1.5 rounded-full bg-(--accent-primary) animate-pulse" />
        {STATUS_LABELS[status]}
      </span>
    );
  }
  if (status === "open") {
    return (
      <span className="inline-flex items-center rounded-full bg-(--success)/15 px-2.5 py-1 text-xs font-semibold text-(--success)">
        {STATUS_LABELS[status]}
      </span>
    );
  }
  if (status === "cancelled") {
    return (
      <span className="inline-flex items-center rounded-full bg-(--warning)/15 px-2.5 py-1 text-xs font-semibold text-(--warning)">
        {STATUS_LABELS[status]}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-(--bg-tertiary) px-2.5 py-1 text-xs font-semibold text-(--text-tertiary)">
      {STATUS_LABELS[status]}
    </span>
  );
}

// ── Tournament card ───────────────────────────────────────────────────────────
function TournamentCard({
  tournament,
  now,
  joining,
  joined,
  onJoin,
}: {
  tournament: Tournament;
  now: number;
  joining: boolean;
  joined: boolean;
  onJoin: (t: Tournament) => void;
}) {
  const navigate = useNavigate();
  const { isConnected } = useWalletStore();
  const t = tournament;

  const count = t.participant_count ?? 0;
  const maxPlayers = t.max_players > 0 ? t.max_players : 0;
  const percent =
    maxPlayers > 0 ? Math.min(100, Math.round((count / maxPlayers) * 100)) : 0;
  const countdown =
    t.status === "open" && t.starts_at ? formatCountdown(t.starts_at, now) : "";

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-(--border) bg-(--bg-secondary) p-5 transition-colors hover:border-(--accent-primary)/40">
      {/* Status + countdown */}
      <div className="flex items-center justify-between gap-2 min-h-6">
        <StatusBadge status={t.status} />
        {countdown && (
          <span className="text-xs font-semibold text-(--text-secondary)">
            {countdown}
          </span>
        )}
      </div>

      {/* Title */}
      <h3 className="font-bold text-lg leading-snug line-clamp-2">{t.title}</h3>

      {/* Prize pool + entry fee */}
      <div className="flex items-end justify-between gap-2">
        <div className="flex flex-col">
          <span className="flex items-center gap-1 text-[10px] font-semibold text-(--text-tertiary) uppercase tracking-widest">
            <Coins size={11} />
            Prize Pool
          </span>
          <span className="text-2xl font-bold leading-tight">
            {formatXLM(t.prize_pool)}{" "}
            <span className="text-sm font-semibold text-(--text-secondary)">
              XLM
            </span>
          </span>
        </div>
        <span className="rounded-full border border-(--border) bg-(--bg) px-2.5 py-1 text-xs font-semibold text-(--text-secondary)">
          Entry {formatXLM(t.entry_fee)} XLM
        </span>
      </div>

      {/* Participants */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 text-xs text-(--text-secondary)">
          <Users size={12} className="text-(--text-tertiary)" />
          <span className="font-semibold">
            {count}/{maxPlayers || "?"} players
          </span>
          {t.status === "open" && maxPlayers > 0 && count >= maxPlayers && (
            <span className="ml-auto text-[10px] font-semibold text-(--warning)">
              Full
            </span>
          )}
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-(--bg-tertiary)">
          <div
            className="h-full rounded-full bg-(--accent-primary) transition-all duration-500"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      {/* Winner (completed) */}
      {t.status === "completed" && t.winner_address && (
        <div className="flex items-center gap-1.5 text-xs text-(--warning)">
          <Crown size={12} />
          <span>Winner:</span>
          <span className="font-mono font-semibold">
            {shortenAddress(t.winner_address)}
          </span>
        </div>
      )}

      <div className="flex-1" />

      {/* Actions */}
      {t.status === "open" ? (
        joined ? (
          <button
            disabled
            className="w-full rounded-xl border border-(--success)/40 bg-(--success)/15 py-2.5 font-bold text-(--success)"
          >
            &#10003; Joined
          </button>
        ) : (
          <button
            onClick={() => onJoin(t)}
            disabled={joining}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-(--accent-dark) py-2.5 font-bold transition-all hover:bg-(--accent-primary) disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
          >
            {joining ? (
              <>
                <Spinner size={16} />
                Joining&#8230;
              </>
            ) : (
              <>
                <Wallet size={15} />
                Join Tournament
              </>
            )}
          </button>
        )
      ) : t.status === "cancelled" ? (
        <button
          disabled
          className="w-full rounded-xl border border-(--border) bg-(--bg-tertiary) py-2.5 font-semibold text-(--text-tertiary)"
        >
          Cancelled
        </button>
      ) : (
        <button
          onClick={() => navigate(`/tournaments/${t.id}/bracket`)}
          className="w-full rounded-xl border border-(--border) bg-(--bg-tertiary) py-2.5 font-bold transition-all hover:bg-(--bg) active:scale-[0.98] flex items-center justify-center gap-2"
        >
          <Trophy size={15} />
          {t.status === "active" ? "View Bracket" : "Final Bracket"}
        </button>
      )}
      {t.status === "open" && !isConnected && (
        <p className="text-center text-[10px] text-(--text-tertiary)">
          Connect your wallet to register
        </p>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function TournamentPage() {
  const [filter, setFilter] = useState<TournamentFilter>("live");
  const [search, setSearch] = useState("");
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [joiningId, setJoiningId] = useState<Tournament["id"] | null>(null);
  const [joinedIds, setJoinedIds] = useState<Set<Tournament["id"]>>(new Set());
  const [now, setNow] = useState(() => Date.now());

  const { addToast } = useToastStore();
  const { address, isConnected } = useWalletStore();

  // Fetch tournaments on mount, on retry, and poll for live participant counts.
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const data = await fetchTournaments();
        if (active) {
          setTournaments(data);
          setError(null);
        }
      } catch (err: unknown) {
        if (active) {
          setError(
            err instanceof Error ? err.message : "Failed to load tournaments",
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    const id = setInterval(load, 20000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [refreshKey]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return tournaments.filter(
      (t) =>
        matchesFilter(t, filter) &&
        (!query || t.title.toLowerCase().includes(query)),
    );
  }, [tournaments, filter, search]);

  const counts = useMemo(() => {
    const c: Record<TournamentFilter, number> = {
      all: 0,
      live: 0,
      upcoming: 0,
      past: 0,
    };
    for (const t of tournaments) {
      c.all += 1;
      if (t.status === "active") c.live += 1;
      if (t.status === "open") c.upcoming += 1;
      if (t.status === "completed" || t.status === "cancelled") c.past += 1;
    }
    return c;
  }, [tournaments]);

  // Tick the countdown clock only while a visible card shows one.
  const hasCountdowns = visible.some(
    (t) => t.status === "open" && !!t.starts_at,
  );
  useEffect(() => {
    if (!hasCountdowns) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasCountdowns]);

  // ── Join with wallet-connection check ───────────────────────────────────────
  const handleJoin = async (t: Tournament) => {
    if (!isConnected || !address) {
      addToast("Connect your wallet to join tournaments", "error");
      return;
    }
    setJoiningId(t.id);
    try {
      await joinTournament(t.id, address);
      setJoinedIds((prev) => new Set(prev).add(t.id));
      setTournaments((prev) =>
        prev.map((x) =>
          x.id === t.id
            ? { ...x, participant_count: (x.participant_count ?? 0) + 1 }
            : x,
        ),
      );
      addToast(`You're in! Good luck in "${t.title}"`, "success");
    } catch (err: unknown) {
      addToast(
        err instanceof Error ? err.message : "Failed to join tournament",
        "error",
      );
    } finally {
      setJoiningId(null);
    }
  };

  return (
    <div className="h-svh w-screen overflow-hidden flex flex-col bg-(--bg)">
      {/* ── Header bar ── */}
      <header className="shrink-0 h-14 flex items-center justify-between px-5 sm:px-8 border-b border-(--border)/40">
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="text-xl font-bold tracking-tight hover:opacity-80 transition-opacity"
          >
            Chesster
          </Link>
          <span className="hidden sm:block text-(--text-tertiary) text-xs">
            Tournament Hub
          </span>
        </div>
        <WalletDropdown />
      </header>

      {/* ── Scrollable body ── */}
      <main className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6">
          {/* Title */}
          <div>
            <h1 className="text-3xl font-bold">&#127942; Tournaments</h1>
            <p className="mt-1 text-sm text-(--text-secondary)">
              Compete in on-chain chess events &#183; entry fees and prize pools
              are escrowed on Stellar
            </p>
          </div>

          {/* Filters + search */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                    filter === f.key
                      ? "border-(--accent-primary) bg-(--accent-dark) text-white"
                      : "border-(--border) bg-(--bg-secondary) text-(--text-secondary) hover:border-(--accent-primary)/50"
                  }`}
                >
                  {f.label}
                  <span
                    className={`rounded-full px-1.5 text-[10px] font-mono ${
                      filter === f.key
                        ? "bg-white/20"
                        : "bg-(--bg-tertiary) text-(--text-tertiary)"
                    }`}
                  >
                    {counts[f.key]}
                  </span>
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 sm:ml-auto">
              <div className="relative flex-1 sm:w-64">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-(--text-tertiary)"
                />
                <input
                  type="text"
                  placeholder="Search tournaments"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full rounded-xl border border-(--border) bg-(--bg-secondary) py-2 pl-9 pr-3 text-sm text-(--text) placeholder:text-(--text-tertiary) outline-none focus:ring-2 focus:ring-(--accent-primary) transition-all"
                />
              </div>
              <button
                onClick={() => setRefreshKey((k) => k + 1)}
                aria-label="Refresh tournaments"
                className="shrink-0 rounded-xl border border-(--border) bg-(--bg-secondary) p-2.5 text-(--text-secondary) hover:text-(--text) hover:border-(--accent-primary)/50 transition-colors"
              >
                <RefreshCw size={14} />
              </button>
            </div>
          </div>

          {/* Error banner */}
          {error && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-(--error)/40 bg-(--error)/10 px-4 py-3">
              <p className="text-sm text-(--error)">
                Couldn&#8217;t load tournaments: {error}
              </p>
              <button
                onClick={() => setRefreshKey((k) => k + 1)}
                className="flex shrink-0 items-center gap-1.5 rounded-lg bg-(--error)/15 px-3 py-1.5 text-xs font-semibold text-(--error) hover:bg-(--error)/25 transition-colors"
              >
                <RefreshCw size={12} />
                Retry
              </button>
            </div>
          )}

          {/* Cards */}
          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="flex flex-col gap-3 rounded-2xl border border-(--border) bg-(--bg-secondary) p-5"
                >
                  <div className="h-6 w-28 rounded-full bg-(--bg-tertiary) animate-pulse" />
                  <div className="h-5 w-3/4 rounded-lg bg-(--bg-tertiary) animate-pulse" />
                  <div className="h-8 w-32 rounded-lg bg-(--bg-tertiary) animate-pulse" />
                  <div className="h-1.5 w-full rounded-full bg-(--bg-tertiary) animate-pulse" />
                  <div className="h-11 w-full rounded-xl bg-(--bg-tertiary) animate-pulse" />
                </div>
              ))}
            </div>
          ) : visible.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {visible.map((t) => (
                <TournamentCard
                  key={t.id}
                  tournament={t}
                  now={now}
                  joining={joiningId === t.id}
                  joined={joinedIds.has(t.id)}
                  onJoin={handleJoin}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-(--border) bg-(--bg-secondary) py-16 px-6 text-center">
              <Trophy size={32} className="text-(--text-tertiary)" />
              <p className="font-semibold">{EMPTY_MESSAGES[filter]}</p>
              {search.trim() && (
                <p className="text-sm text-(--text-tertiary)">
                  Nothing matches &#8220;{search.trim()}&#8221; in this view.
                </p>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
