import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertTriangle, Check, Copy, Eye, RefreshCw, UserX } from "lucide-react";
import {
	fetchPlayerProfile,
	ProfileNotFoundError,
	type GameResult,
	type PlayerProfile,
	type RecentGame,
} from "../api/profileApi";
import RatingChart from "../components/RatingChart";
import WalletDropdown from "../components/WalletDropdown";
import { useWalletStore } from "../store/walletStore";
import {
	PROFILE_TABS,
	formatWinRate,
	getProfileView,
	shortenAddress,
	type ProfileTab,
} from "../utils/profileStats";

type LoadState =
	| { key: string; status: "success"; profile: PlayerProfile }
	| { key: string; status: "not-found" }
	| { key: string; status: "error"; message: string };

const RESULT_BADGES: Record<GameResult, { label: string; className: string }> = {
	win: { label: "Win", className: "bg-green-500/15 text-green-500 border-green-500/30" },
	loss: { label: "Loss", className: "bg-red-500/15 text-red-400 border-red-500/30" },
	draw: { label: "Draw", className: "bg-(--bg-tertiary) text-(--text-secondary) border-(--border)" },
};

const formatDate = (iso: string | null) =>
	iso && !Number.isNaN(Date.parse(iso))
		? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
		: "–";

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
	return (
		<div className="rounded-xl border border-(--border) bg-(--bg-secondary) px-4 py-3">
			<div className="text-[11px] font-semibold uppercase tracking-wider text-(--text-tertiary)">{label}</div>
			<div className={`mt-1 font-mono text-2xl font-bold ${accent ?? "text-(--text)"}`}>{value}</div>
		</div>
	);
}

function RecentGameRow({ game }: { game: RecentGame }) {
	const badge = RESULT_BADGES[game.result];
	const opponentLabel = game.opponentName ?? (game.opponentAddress ? shortenAddress(game.opponentAddress) : "Unknown");

	return (
		<li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 sm:flex-nowrap">
			<span className={`w-12 shrink-0 rounded-md border px-1.5 py-0.5 text-center text-xs font-bold ${badge.className}`}>
				{badge.label}
			</span>

			<div className="min-w-0 flex-1">
				<div className="truncate text-sm">
					<span className="text-(--text-tertiary)">vs </span>
					{game.opponentAddress ? (
						<Link
							to={`/profile/${encodeURIComponent(game.opponentAddress)}`}
							className="font-medium hover:text-(--accent-primary) transition-colors"
							title={game.opponentAddress}
						>
							{opponentLabel}
						</Link>
					) : (
						<span className="font-medium">{opponentLabel}</span>
					)}
				</div>
				<div className="text-xs text-(--text-tertiary)">
					{[game.mode && game.mode[0].toUpperCase() + game.mode.slice(1), game.color && `as ${game.color}`, formatDate(game.playedAt)]
						.filter(Boolean)
						.join(" · ")}
				</div>
			</div>

			{game.ratingChange !== null && (
				<span
					className={`font-mono text-sm ${
						game.ratingChange > 0 ? "text-green-500" : game.ratingChange < 0 ? "text-red-400" : "text-(--text-tertiary)"
					}`}
				>
					{game.ratingChange > 0 ? `+${game.ratingChange}` : game.ratingChange}
				</span>
			)}

			<Link
				to={`/spectate/${encodeURIComponent(game.gameCode)}`}
				className="ml-auto flex shrink-0 items-center gap-1 rounded-lg border border-(--border) px-2.5 py-1 text-xs text-(--text-secondary) hover:border-(--accent-primary)/50 hover:text-(--text) transition-colors"
				aria-label={`Replay game ${game.gameCode}`}
			>
				<Eye size={12} />
				Replay
			</Link>
		</li>
	);
}

function ProfileSkeleton() {
	return (
		<div className="flex animate-pulse flex-col gap-5" aria-busy="true" aria-label="Loading profile">
			<div className="h-24 rounded-2xl bg-(--bg-secondary)" />
			<div className="h-9 w-80 max-w-full rounded-full bg-(--bg-secondary)" />
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
				{Array.from({ length: 5 }, (_, i) => (
					<div key={i} className="h-20 rounded-xl bg-(--bg-secondary)" />
				))}
			</div>
			<div className="h-56 rounded-lg bg-(--bg-secondary)" />
		</div>
	);
}

function MessageState({ icon, title, children }: { icon: React.ReactNode; title: string; children?: React.ReactNode }) {
	return (
		<div className="flex flex-col items-center gap-3 rounded-2xl border border-(--border) bg-(--bg-secondary) px-6 py-16 text-center">
			<div className="text-(--text-tertiary)">{icon}</div>
			<h2 className="text-lg font-semibold">{title}</h2>
			{children}
		</div>
	);
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ProfilePage() {
	const { address = "" } = useParams<{ address: string }>();
	const walletAddress = useWalletStore((s) => s.address);
	const [tab, setTab] = useState<ProfileTab>("all");
	const [reloadKey, setReloadKey] = useState(0);
	const [loadState, setLoadState] = useState<LoadState | null>(null);
	const [copied, setCopied] = useState(false);

	const requestKey = `${address}:${reloadKey}`;

	useEffect(() => {
		if (!address) return;
		const key = `${address}:${reloadKey}`;
		const controller = new AbortController();

		fetchPlayerProfile(address, controller.signal)
			.then((profile) => setLoadState({ key, status: "success", profile }))
			.catch((err: unknown) => {
				if (controller.signal.aborted) return;
				if (err instanceof ProfileNotFoundError) {
					setLoadState({ key, status: "not-found" });
				} else {
					setLoadState({
						key,
						status: "error",
						message: err instanceof Error ? err.message : "Failed to load profile",
					});
				}
			});

		return () => controller.abort();
	}, [address, reloadKey]);

	// Results for a previous address / attempt are treated as still loading.
	const current = loadState?.key === requestKey ? loadState : null;
	const profile = current?.status === "success" ? current.profile : null;
	const view = useMemo(() => (profile ? getProfileView(profile, tab) : null), [profile, tab]);
	const isOwnProfile = !!walletAddress && walletAddress === address;

	const copyAddress = () => {
		navigator.clipboard?.writeText(address).then(
			() => {
				setCopied(true);
				setTimeout(() => setCopied(false), 1500);
			},
			() => {},
		);
	};

	return (
		<div className="h-svh w-screen overflow-hidden flex flex-col bg-(--bg)">
			{/* ── Header bar ── */}
			<header className="shrink-0 h-14 flex items-center justify-between px-5 sm:px-8 border-b border-(--border)/40">
				<div className="flex items-center gap-3">
					<Link to="/" className="text-xl font-bold tracking-tight hover:opacity-80 transition-opacity">
						Chesster
					</Link>
					<span className="hidden sm:block text-(--text-tertiary) text-xs">Player Profile</span>
				</div>
				<WalletDropdown />
			</header>

			{/* ── Scrollable body ── */}
			<main className="flex-1 min-h-0 overflow-y-auto">
				<div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6 sm:px-6">
					{!current && <ProfileSkeleton />}

					{current?.status === "not-found" && (
						<MessageState icon={<UserX size={36} />} title="Player not found">
							<p className="text-sm text-(--text-secondary)">
								No profile exists for <span className="font-mono break-all">{address}</span> yet.
							</p>
							<Link to="/" className="text-sm font-semibold text-(--accent-primary) hover:underline">
								Back to lobby
							</Link>
						</MessageState>
					)}

					{current?.status === "error" && (
						<MessageState icon={<AlertTriangle size={36} />} title="Couldn't load this profile">
							<p className="text-sm text-(--text-secondary)">{current.message}</p>
							<button
								onClick={() => setReloadKey((k) => k + 1)}
								className="flex items-center gap-1.5 rounded-xl border border-(--border) bg-(--bg-tertiary) px-3 py-1.5 text-sm hover:border-(--accent-primary)/50 transition-colors"
							>
								<RefreshCw size={14} />
								Try again
							</button>
						</MessageState>
					)}

					{profile && view && (
						<>
							{/* Identity */}
							<section className="flex flex-col gap-4 rounded-2xl border border-(--border) bg-(--bg-secondary) p-5 sm:flex-row sm:items-center">
								{profile.avatarUrl ? (
									<img
										src={profile.avatarUrl}
										alt=""
										className="h-16 w-16 shrink-0 rounded-full border border-(--border) object-cover"
									/>
								) : (
									<div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-(--accent-dark) text-2xl font-bold text-white">
										{(profile.username ?? profile.address).charAt(0).toUpperCase()}
									</div>
								)}

								<div className="min-w-0 flex-1">
									<div className="flex items-center gap-2">
										<h1 className="truncate text-2xl font-bold">
											{profile.username ?? shortenAddress(profile.address)}
										</h1>
										{isOwnProfile && (
											<span className="rounded-full bg-(--accent-dark) px-2 py-0.5 text-[10px] font-bold uppercase text-white">
												You
											</span>
										)}
									</div>
									<button
										onClick={copyAddress}
										className="mt-1 flex max-w-full items-center gap-1.5 text-xs font-mono text-(--text-tertiary) hover:text-(--text-secondary) transition-colors"
										title="Copy wallet address"
									>
										<span className="truncate">{profile.address}</span>
										{copied ? <Check size={12} className="shrink-0 text-green-500" /> : <Copy size={12} className="shrink-0" />}
									</button>
								</div>

								<div className="sm:text-right">
									<div className="text-[11px] font-semibold uppercase tracking-wider text-(--text-tertiary)">
										{tab === "all" ? "Rating" : `${PROFILE_TABS.find((t) => t.key === tab)?.label} rating`}
									</div>
									<div className="font-mono text-3xl font-bold text-(--accent-primary)">{view.rating ?? "–"}</div>
								</div>
							</section>

							{/* Game mode tabs */}
							<div role="tablist" aria-label="Game mode" className="flex flex-wrap gap-1.5">
								{PROFILE_TABS.map((t) => (
									<button
										key={t.key}
										role="tab"
										aria-selected={tab === t.key}
										onClick={() => setTab(t.key)}
										className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors ${
											tab === t.key
												? "border-(--accent-primary) bg-(--accent-dark) text-white"
												: "border-(--border) bg-(--bg-secondary) text-(--text-secondary) hover:border-(--accent-primary)/50"
										}`}
									>
										{t.label}
									</button>
								))}
							</div>

							{/* Stats */}
							<section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-label="Statistics">
								<StatCard label="Total games" value={view.stats.games} />
								<StatCard label="Wins" value={view.stats.wins} accent="text-green-500" />
								<StatCard label="Draws" value={view.stats.draws} />
								<StatCard label="Losses" value={view.stats.losses} accent="text-red-400" />
								<StatCard label="Win rate" value={formatWinRate(view.stats)} />
							</section>

							{/* Rating history */}
							<section className="flex flex-col gap-2">
								<h2 className="text-sm font-bold uppercase tracking-wider text-(--text-tertiary)">Rating history</h2>
								<RatingChart history={view.ratingHistory} />
							</section>

							{/* Recent games */}
							<section className="flex flex-col gap-2">
								<h2 className="text-sm font-bold uppercase tracking-wider text-(--text-tertiary)">Recent games</h2>
								{view.recentGames.length === 0 ? (
									<div className="rounded-xl border border-(--border) bg-(--bg-secondary) px-4 py-8 text-center text-sm text-(--text-tertiary)">
										No games played yet
									</div>
								) : (
									<ul className="divide-y divide-(--border) overflow-hidden rounded-xl border border-(--border) bg-(--bg-secondary)">
										{view.recentGames.map((game) => (
											<RecentGameRow key={game.gameCode} game={game} />
										))}
									</ul>
								)}
							</section>
						</>
					)}
				</div>
			</main>
		</div>
	);
}
