import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
	ArrowLeft,
	Crosshair,
	Crown,
	Medal,
	RefreshCw,
	Trophy,
} from "lucide-react";
import {
	getLeaderboard,
	type LeaderboardCategory,
	type LeaderboardEntry,
} from "../api/leaderboardApi";
import { useWalletStore } from "../store/walletStore";

// ── Helpers ───────────────────────────────────────────────────────────────────
const shortenAddress = (addr: string) =>
	addr.length > 12 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr;

const formatXLM = (v: number) => {
	if (!Number.isFinite(v)) return "–";
	return Number.isInteger(v) ? String(v) : v.toFixed(2);
};

const formatWinRate = (rate: number) => {
	if (!Number.isFinite(rate)) return "–";
	return `${Math.round(rate * 100)}%`;
};

const displayName = (entry: LeaderboardEntry) =>
	entry.username && entry.username.trim().length > 0
		? entry.username
		: shortenAddress(entry.address);

/** Time-control filter tabs (#316); "all" shows the global ranking. */
const CATEGORIES: {
	value: LeaderboardCategory;
	label: string;
	hint: string;
}[] = [
	{ value: "all", label: "All", hint: "Every time control" },
	{ value: "bullet", label: "Bullet", hint: "Games under 3 minutes" },
	{ value: "blitz", label: "Blitz", hint: "Games of 3-10 minutes" },
	{ value: "rapid", label: "Rapid", hint: "Games of 10-60 minutes" },
];

/** Medal colour for the top three ranks; later ranks show the plain number. */
function RankBadge({ rank }: { rank: number }) {
	if (rank === 1)
		return <Crown size={18} className="text-yellow-400" aria-hidden="true" />;
	if (rank === 2)
		return <Medal size={18} className="text-slate-300" aria-hidden="true" />;
	if (rank === 3)
		return <Medal size={18} className="text-amber-600" aria-hidden="true" />;
	return <span className="text-(--text-tertiary) font-semibold">{rank}</span>;
}

export default function LeaderboardPage() {
	const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	// Active time-control filter (#316).
	const [category, setCategory] = useState<LeaderboardCategory>("all");
	const walletAddress = useWalletStore((s) => s.address);

	// Manual refresh (button handler): setting state synchronously here is fine
	// because it runs from an event, not from an effect body.
	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const data = await getLeaderboard(category);
			setEntries(data);
		} catch {
			setError("Could not load the leaderboard. Please try again.");
		} finally {
			setLoading(false);
		}
	}, [category]);

	// Initial fetch on mount. State is updated only in the async callbacks (after
	// the request settles), never synchronously in the effect body.
	useEffect(() => {
		let cancelled = false;
		getLeaderboard(category)
			.then((data) => {
				if (!cancelled) setEntries(data);
			})
			.catch(() => {
				if (!cancelled)
					setError("Could not load the leaderboard. Please try again.");
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [category]);

	const myEntry = useMemo(
		() => entries.find((e) => e.address === walletAddress) ?? null,
		[entries, walletAddress],
	);
	const topThree = entries.slice(0, 3);

	return (
		<main className="min-h-screen bg-(--bg) text-(--text) px-4 py-6 sm:px-6 lg:px-8">
			<div className="mx-auto w-full max-w-4xl">
				{/* Header */}
				<div className="flex items-center justify-between gap-3 mb-6">
					<div className="flex items-center gap-3">
						<Link
							to="/"
							aria-label="Back to lobby"
							className="p-2 rounded-lg border border-(--border) hover:bg-(--bg-secondary) transition-colors"
						>
							<ArrowLeft size={18} />
						</Link>
						<h1 className="flex items-center gap-2 text-xl sm:text-2xl font-bold">
							<Trophy size={22} className="text-yellow-400" aria-hidden="true" />
							Leaderboard
						</h1>
					</div>
					<button
						type="button"
						onClick={load}
						disabled={loading}
						aria-label="Refresh leaderboard"
						className="flex items-center gap-2 px-3 py-2 text-sm font-semibold rounded-lg border border-(--border) hover:bg-(--bg-secondary) disabled:opacity-50 transition-colors"
					>
						<RefreshCw size={16} className={loading ? "animate-spin" : ""} />
						<span className="hidden sm:inline">Refresh</span>
					</button>
				</div>

				<p className="text-sm text-(--text-tertiary) mb-4">
					Top ranked players by Elo rating, win rate, and total XLM earnings.
				</p>

				{/* ── Time-control filter tabs (#316) ── */}
				<div
					role="group"
					aria-label="Filter by time control"
					className="flex flex-wrap gap-1 rounded-xl border border-(--border) bg-(--bg-secondary) p-1 mb-6 w-fit"
				>
					{CATEGORIES.map((c) => {
						const active = category === c.value;
						return (
							<button
								key={c.value}
								type="button"
								aria-pressed={active}
								title={c.hint}
								onClick={() => setCategory(c.value)}
								className={`px-3 py-1.5 text-sm font-semibold rounded-lg transition-colors ${
									active
										? "bg-(--accent-dark) text-white"
										: "text-(--text-secondary) hover:bg-(--bg-tertiary)"
								}`}
							>
								{c.label}
							</button>
						);
					})}
				</div>

				{/* States */}
				{loading ? (
					<div
						className="py-16 text-center text-(--text-tertiary)"
						role="status"
						aria-live="polite"
					>
						Loading leaderboard…
					</div>
				) : error ? (
					<div
						className="py-12 text-center"
						role="alert"
						aria-live="assertive"
					>
						<p className="text-(--text) font-semibold mb-3">{error}</p>
						<button
							type="button"
							onClick={load}
							className="px-4 py-2 text-sm font-semibold rounded-lg bg-(--accent-dark) hover:bg-(--accent-primary) transition-colors"
						>
							Try again
						</button>
					</div>
				) : entries.length === 0 ? (
					<div className="py-16 text-center text-(--text-tertiary)">
						No ranked players yet. Play a game to claim the top spot.
					</div>
				) : (
					<>
						{/* ── Top-3 podium (#316) ── */}
						{topThree.length > 0 && (
							<ol
								className="flex items-end justify-center gap-2 sm:gap-4 mb-6"
								aria-label="Top three players"
							>
								{topThree.map((entry) => (
									<li
										key={entry.address}
										className={`flex-1 max-w-40 rounded-xl border p-3 text-center ${
											entry.rank === 1
												? "order-2 -translate-y-2 border-yellow-400/60 bg-yellow-400/10"
												: entry.rank === 2
													? "order-1 border-(--border) bg-(--bg-secondary)"
													: "order-3 border-(--border) bg-(--bg-secondary)"
										}`}
									>
										<div className="flex justify-center mb-1">
											<RankBadge rank={entry.rank} />
										</div>
										<p
											className="font-semibold text-sm truncate"
											title={displayName(entry)}
										>
											{displayName(entry)}
										</p>
										<p className="text-xs text-(--text-tertiary) tabular-nums">
											{entry.elo} Elo · {formatWinRate(entry.winRate)}
										</p>
									</li>
								))}
							</ol>
						)}

						{/* Table on sm+ screens */}
						<div className="hidden sm:block overflow-x-auto rounded-xl border border-(--border)">
							<table className="w-full text-sm">
								<caption className="sr-only">
									Global player rankings
								</caption>
								<thead>
									<tr className="bg-(--bg-secondary) text-(--text-tertiary) text-left">
										<th scope="col" className="px-4 py-3 font-semibold w-16">
											Rank
										</th>
										<th scope="col" className="px-4 py-3 font-semibold">
											Player
										</th>
										<th scope="col" className="px-4 py-3 font-semibold text-right">
											Elo
										</th>
										<th scope="col" className="px-4 py-3 font-semibold text-right">
											Win rate
										</th>
										<th scope="col" className="px-4 py-3 font-semibold text-right">
											W/L/D
										</th>
										<th scope="col" className="px-4 py-3 font-semibold text-right">
											Earnings
										</th>
									</tr>
								</thead>
								<tbody>
									{entries.map((entry) => {
											const isMe = myEntry !== null && entry.address === myEntry.address;
											return (
										<tr
											key={entry.address}
											className={`border-t border-(--border) hover:bg-(--bg-secondary)/60 transition-colors ${
												isMe ? "bg-yellow-400/10 hover:bg-yellow-400/15" : ""
											}`}
										>
											<td className="px-4 py-3">
												<span className="flex items-center justify-center w-6">
													<RankBadge rank={entry.rank} />
												</span>
											</td>
											<td className="px-4 py-3 font-medium">
												{displayName(entry)}
											</td>
											<td className="px-4 py-3 text-right tabular-nums font-semibold">
												{entry.elo}
											</td>
											<td className="px-4 py-3 text-right tabular-nums">
												{formatWinRate(entry.winRate)}
											</td>
											<td className="px-4 py-3 text-right tabular-nums text-(--text-tertiary)">
												{entry.wins}/{entry.losses}/{entry.draws}
											</td>
											<td className="px-4 py-3 text-right tabular-nums font-semibold">
												{formatXLM(entry.totalEarnings)} XLM
											</td>
										</tr>
										);
										})}
								</tbody>
							</table>
						</div>

						{/* Card list on mobile */}
						<ul className="sm:hidden flex flex-col gap-3">
							{entries.map((entry) => (
							<li
								key={entry.address}
								className={`rounded-xl border p-4 ${
									myEntry !== null && entry.address === myEntry.address
										? "border-yellow-400/50 bg-yellow-400/10"
										: "border-(--border) bg-(--bg-secondary)"
								}`}
							>
									<div className="flex items-center justify-between mb-2">
										<div className="flex items-center gap-2 font-semibold">
											<RankBadge rank={entry.rank} />
											<span>{displayName(entry)}</span>
										</div>
										<span className="tabular-nums font-bold">
											{entry.elo}
											<span className="text-xs text-(--text-tertiary) ml-1">
												Elo
											</span>
										</span>
									</div>
									<div className="grid grid-cols-3 gap-2 text-xs text-(--text-tertiary)">
										<span>Win rate: {formatWinRate(entry.winRate)}</span>
										<span>
											W/L/D: {entry.wins}/{entry.losses}/{entry.draws}
										</span>
										<span className="text-right">
											{formatXLM(entry.totalEarnings)} XLM
										</span>
									</div>
								</li>
							))}
						</ul>

						{/* ── Your rank (#316) ── */}
						{myEntry && (
							<div className="sticky bottom-4 z-10 mt-6 flex items-center justify-between gap-3 rounded-xl border border-yellow-400/50 bg-(--bg-secondary) px-4 py-3 shadow-lg">
								<p className="flex items-center gap-2 font-semibold text-sm min-w-0">
									<Crosshair
										size={16}
										className="text-yellow-400 shrink-0"
										aria-hidden="true"
									/>
									<span className="truncate">Your rank</span>
								</p>
								<p className="flex items-center gap-3 text-sm tabular-nums shrink-0">
									<span className="font-bold">#{myEntry.rank}</span>
									<span className="text-(--text-tertiary) truncate max-w-32">
										{displayName(myEntry)}
									</span>
									<span className="text-(--text-tertiary)">
										{myEntry.elo} Elo
									</span>
								</p>
							</div>
						)}
					</>
				)}
			</div>
		</main>
	);
}
