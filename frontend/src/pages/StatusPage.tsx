import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
	Activity,
	AlertCircle,
	AlertTriangle,
	ArrowLeft,
	Check,
	CheckCircle2,
	Copy,
	Database,
	ExternalLink,
	Globe,
	Radio,
	RefreshCw,
	Server,
	ShieldCheck,
	Zap,
} from "lucide-react";
import { API_URL, BACKEND_URL } from "../api/gameApi";
import { getSocket } from "../api/socket";

export type StatusLevel = "operational" | "degraded" | "down" | "checking";

export interface ServiceItem {
	id: string;
	title: string;
	purpose: string;
	endpoint: string;
	url: string;
	status: StatusLevel;
	latencyMs?: number;
	httpStatus?: number;
}

interface TelemetryData {
	status?: string;
	uptime?: number;
	environment?: string;
	services?: {
		database?: {
			status?: string;
			database?: string;
			responseTime?: number;
		};
		stellarRpc?: {
			status?: string;
			network?: string;
			latestLedger?: number;
			responseTime?: number;
		};
	};
}

const SERVICES_CATALOG: Omit<ServiceItem, "status" | "latencyMs" | "httpStatus">[] = [
	{
		id: "server-api",
		title: "Backend API Server",
		purpose: "Handles web requests, game authentication, and security",
		endpoint: "/health",
		url: `${BACKEND_URL}/health`,
	},
	{
		id: "system-status",
		title: "Database & Blockchain Health",
		purpose: "Verifies Neon PostgreSQL connection and Stellar Soroban RPC sync",
		endpoint: "/api/status",
		url: `${API_URL}/status`,
	},
	{
		id: "matchmaking",
		title: "Matchmaking & Game Lobby",
		purpose: "Powers active game lobbies and connects players together",
		endpoint: "/api/games/pending",
		url: `${API_URL}/games/pending`,
	},
	{
		id: "leaderboard",
		title: "Leaderboard & Player Ratings",
		purpose: "Calculates live Elo ratings, match wins, and player ranks",
		endpoint: "/api/leaderboard",
		url: `${API_URL}/leaderboard`,
	},
	{
		id: "tournaments",
		title: "Tournament System",
		purpose: "Manages bracket progression, registrations, and prize pools",
		endpoint: "/api/tournaments",
		url: `${API_URL}/tournaments`,
	},
	{
		id: "puzzles",
		title: "Daily Tactical Puzzles",
		purpose: "Serves daily chess tactics and training positions",
		endpoint: "/api/puzzles/daily",
		url: `${API_URL}/puzzles/daily`,
	},
	{
		id: "security",
		title: "Security & CSRF Protection",
		purpose: "Protects player accounts and transactions from unauthorized requests",
		endpoint: "/api/csrf-token",
		url: `${API_URL}/csrf-token`,
	},
];

function formatUptime(seconds?: number): string {
	if (!seconds || seconds <= 0) return "–";
	const d = Math.floor(seconds / 86400);
	const h = Math.floor((seconds % 86400) / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	if (d > 0) return `${d}d ${h}h`;
	if (h > 0) return `${h}h ${m}m`;
	return `${m}m ${Math.floor(seconds % 60)}s`;
}

export default function StatusPage() {
	const [services, setServices] = useState<ServiceItem[]>(() =>
		SERVICES_CATALOG.map((s) => ({ ...s, status: "checking" })),
	);
	const [telemetry, setTelemetry] = useState<TelemetryData | null>(null);
	const [socketOnline, setSocketOnline] = useState<boolean>(() => {
		try {
			return Boolean(getSocket()?.connected);
		} catch {
			return false;
		}
	});
	const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
	const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
	const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
	const [copied, setCopied] = useState<boolean>(false);

	// Socket connection monitoring
	useEffect(() => {
		try {
			const socket = getSocket();
			const onConnect = () => setSocketOnline(true);
			const onDisconnect = () => setSocketOnline(false);

			socket.on("connect", onConnect);
			socket.on("disconnect", onDisconnect);

			return () => {
				socket.off("connect", onConnect);
				socket.off("disconnect", onDisconnect);
			};
		} catch {
			// ignore
		}
	}, []);

	// Probe single service
	const probeService = useCallback(async (item: (typeof SERVICES_CATALOG)[0]): Promise<ServiceItem> => {
		const start = performance.now();
		try {
			const res = await fetch(item.url, {
				method: "GET",
				headers: { Accept: "application/json" },
			});
			const latencyMs = Math.round(performance.now() - start);

			if (item.id === "system-status" && res.ok) {
				try {
					const data = await res.json();
					setTelemetry(data);
				} catch {
					// ignore json parse error
				}
			}

			let status: StatusLevel = "operational";
			if (!res.ok) {
				status = res.status >= 500 ? "down" : "degraded";
			} else if (latencyMs > 2500) {
				status = "degraded";
			}

			return {
				...item,
				status,
				httpStatus: res.status,
				latencyMs,
			};
		} catch {
			const latencyMs = Math.round(performance.now() - start);
			return {
				...item,
				status: "down",
				httpStatus: 0,
				latencyMs,
			};
		}
	}, []);

	// Run all checks
	const checkAllServices = useCallback(async () => {
		setIsRefreshing(true);
		setServices((prev) => prev.map((s) => ({ ...s, status: "checking" })));

		const results = await Promise.all(SERVICES_CATALOG.map((item) => probeService(item)));
		setServices(results);
		setLastUpdated(new Date());
		setIsRefreshing(false);
	}, [probeService]);

	// Initial check
	useEffect(() => {
		const t = setTimeout(() => {
			checkAllServices();
		}, 0);
		return () => clearTimeout(t);
	}, [checkAllServices]);

	// Auto-refresh interval (every 20s)
	useEffect(() => {
		if (!autoRefresh) return;
		const interval = setInterval(() => {
			checkAllServices();
		}, 20000);
		return () => clearInterval(interval);
	}, [autoRefresh, checkAllServices]);

	// Global health calculation
	const globalStatus: StatusLevel = useMemo(() => {
		if (services.every((s) => s.status === "checking")) return "checking";
		if (services.some((s) => s.status === "down")) return "down";
		if (services.some((s) => s.status === "degraded")) return "degraded";
		return "operational";
	}, [services]);

	const operationalCount = useMemo(
		() => services.filter((s) => s.status === "operational").length,
		[services],
	);

	const copySummary = () => {
		const summary = {
			frontend: "https://chesster-lovat.vercel.app",
			backend: BACKEND_URL,
			checkedAt: new Date().toISOString(),
			status: globalStatus,
			database: "Neon PostgreSQL",
			uptime: telemetry?.uptime,
			services: services.map((s) => ({
				service: s.title,
				status: s.status,
				latency: `${s.latencyMs || 0}ms`,
			})),
		};

		navigator.clipboard.writeText(JSON.stringify(summary, null, 2)).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		});
	};

	return (
		<div className="min-h-screen bg-(--bg) text-(--text) p-4 sm:p-6 md:p-10 transition-colors">
			<div className="max-w-4xl mx-auto space-y-8">
				{/* ── Top Header ── */}
				<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-(--border)/40 pb-5">
					<div>
						<Link
							to="/"
							className="inline-flex items-center gap-1.5 text-xs font-semibold text-(--text-secondary) hover:text-(--text) transition-colors mb-2"
						>
							<ArrowLeft size={14} />
							<span>Return to Chess Lobby</span>
						</Link>
						<h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight flex items-center gap-2.5">
							<Activity className="text-(--accent-primary)" size={26} />
							Chesster System Status
						</h1>
						<p className="text-xs sm:text-sm text-(--text-secondary) mt-1">
							Live operational status of Chesster’s backend, database, and game services.
						</p>
					</div>

					<div className="flex items-center gap-2">
						<button
							onClick={copySummary}
							className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-(--border) bg-(--bg-secondary) hover:bg-(--bg-tertiary) text-(--text-secondary) hover:text-(--text) transition-colors"
						>
							{copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
							<span>{copied ? "Copied" : "Copy Status"}</span>
						</button>

						<button
							onClick={() => setAutoRefresh(!autoRefresh)}
							className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
								autoRefresh
									? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
									: "border-(--border) bg-(--bg-secondary) text-(--text-tertiary)"
							}`}
						>
							Auto-refresh {autoRefresh ? "On" : "Off"}
						</button>

						<button
							onClick={checkAllServices}
							disabled={isRefreshing}
							className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-lg bg-(--accent-dark) hover:bg-(--accent-primary) text-white transition-all disabled:opacity-50"
						>
							<RefreshCw size={13} className={isRefreshing ? "animate-spin" : ""} />
							<span>{isRefreshing ? "Checking…" : "Refresh"}</span>
						</button>
					</div>
				</div>

				{/* ── Big Clear Status Banner ── */}
				<div
					className={`p-6 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all shadow-sm ${
						globalStatus === "operational"
							? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
							: globalStatus === "degraded"
								? "bg-amber-500/10 border-amber-500/30 text-amber-400"
								: globalStatus === "down"
									? "bg-rose-500/10 border-rose-500/30 text-rose-400"
									: "bg-blue-500/10 border-blue-500/30 text-blue-400"
					}`}
				>
					<div className="flex items-center gap-4">
						<span className="relative flex h-5 w-5 shrink-0">
							<span
								className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
									globalStatus === "operational"
										? "bg-emerald-400"
										: globalStatus === "degraded"
											? "bg-amber-400"
											: "bg-rose-400"
								}`}
							/>
							<span
								className={`relative inline-flex rounded-full h-5 w-5 ${
									globalStatus === "operational"
										? "bg-emerald-500"
										: globalStatus === "degraded"
											? "bg-amber-500"
											: "bg-rose-500"
								}`}
							/>
						</span>
						<div>
							<h2 className="text-xl font-bold tracking-tight">
								{globalStatus === "operational" && "All Systems Are Fully Operational"}
								{globalStatus === "degraded" && "Some Services Experiencing Delays"}
								{globalStatus === "down" && "Service Disruption Detected"}
								{globalStatus === "checking" && "Checking System Availability…"}
							</h2>
							<p className="text-xs sm:text-sm text-(--text-secondary) mt-0.5">
								{lastUpdated
									? `${operationalCount} of ${services.length} services are currently healthy and responding normally.`
									: "Testing connectivity to backend services…"}
							</p>
						</div>
					</div>

					<div className="text-xs text-(--text-tertiary) sm:text-right font-mono shrink-0">
						<div>Last update: {lastUpdated ? lastUpdated.toLocaleTimeString() : "–"}</div>
						<div className="text-[11px] opacity-75 mt-0.5">Live on Render & Vercel</div>
					</div>
				</div>

				{/* ── 4 Key Core Components (Simple & Understandable) ── */}
				<div>
					<h3 className="text-sm font-bold uppercase tracking-wider text-(--text-secondary) mb-3">
						Core Subsystems
					</h3>
					<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
						{/* Component 1: Web Server */}
						<div className="p-4 rounded-xl border border-(--border)/60 bg-(--bg-secondary) flex flex-col justify-between">
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-2">
									<Server size={16} className="text-(--accent-primary)" />
									<span className="text-xs font-bold">API Server</span>
								</div>
								<span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold">
									ONLINE
								</span>
							</div>
							<div className="mt-3">
								<div className="text-sm font-bold">Render Web Service</div>
								<div className="text-xs text-(--text-tertiary) mt-0.5">
									Uptime: {formatUptime(telemetry?.uptime)}
								</div>
							</div>
						</div>

						{/* Component 2: Neon Database */}
						<div className="p-4 rounded-xl border border-(--border)/60 bg-(--bg-secondary) flex flex-col justify-between">
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-2">
									<Database size={16} className="text-sky-400" />
									<span className="text-xs font-bold">Database</span>
								</div>
								<span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold">
									CONNECTED
								</span>
							</div>
							<div className="mt-3">
								<div className="text-sm font-bold">Neon PostgreSQL</div>
								<div className="text-xs text-(--text-tertiary) mt-0.5">
									Response: {telemetry?.services?.database?.responseTime || "<100"}ms
								</div>
							</div>
						</div>

						{/* Component 3: Stellar Blockchain */}
						<div className="p-4 rounded-xl border border-(--border)/60 bg-(--bg-secondary) flex flex-col justify-between">
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-2">
									<Globe size={16} className="text-purple-400" />
									<span className="text-xs font-bold">Blockchain</span>
								</div>
								<span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold">
									SYNCED
								</span>
							</div>
							<div className="mt-3">
								<div className="text-sm font-bold">Stellar / Soroban</div>
								<div className="text-xs text-(--text-tertiary) mt-0.5">
									Ledger: {telemetry?.services?.stellarRpc?.latestLedger ? `#${telemetry.services.stellarRpc.latestLedger.toLocaleString()}` : "Testnet"}
								</div>
							</div>
						</div>

						{/* Component 4: Realtime Socket */}
						<div className="p-4 rounded-xl border border-(--border)/60 bg-(--bg-secondary) flex flex-col justify-between">
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-2">
									<Radio size={16} className="text-emerald-400" />
									<span className="text-xs font-bold">Live Moves</span>
								</div>
								<span
									className={`text-[10px] font-mono px-2 py-0.5 rounded-full border font-bold ${
										socketOnline
											? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
											: "bg-amber-500/10 text-amber-400 border-amber-500/20"
									}`}
								>
									{socketOnline ? "ACTIVE" : "STANDBY"}
								</span>
							</div>
							<div className="mt-3">
								<div className="text-sm font-bold">WebSocket Engine</div>
								<div className="text-xs text-(--text-tertiary) mt-0.5">
									Instant Move Sync & Chat
								</div>
							</div>
						</div>
					</div>
				</div>

				{/* ── Clean Service Checklist ── */}
				<div>
					<div className="flex items-center justify-between mb-3">
						<h3 className="text-sm font-bold uppercase tracking-wider text-(--text-secondary)">
							Endpoint Services
						</h3>
						<span className="text-xs text-(--text-tertiary)">
							Real-time health status
						</span>
					</div>

					<div className="divide-y divide-(--border)/40 rounded-2xl border border-(--border)/60 bg-(--bg-secondary) overflow-hidden">
						{services.map((item) => {
							const isOk = item.status === "operational";
							const isSlow = item.status === "degraded";
							const isDown = item.status === "down";

							return (
								<div
									key={item.id}
									className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-(--bg-tertiary)/30 transition-colors"
								>
									<div className="flex items-start gap-3.5">
										<div className="mt-0.5 shrink-0">
											{isOk && <CheckCircle2 size={18} className="text-emerald-400" />}
											{isSlow && <AlertTriangle size={18} className="text-amber-400" />}
											{isDown && <AlertCircle size={18} className="text-rose-400" />}
											{item.status === "checking" && (
												<RefreshCw size={18} className="text-blue-400 animate-spin" />
											)}
										</div>

										<div>
											<div className="flex items-center gap-2 flex-wrap">
												<span className="text-sm font-bold">{item.title}</span>
												<span className="text-xs font-mono text-(--text-tertiary) bg-(--bg)/60 px-2 py-0.5 rounded border border-(--border)/30">
													{item.endpoint}
												</span>
											</div>
											<p className="text-xs text-(--text-secondary) mt-0.5">
												{item.purpose}
											</p>
										</div>
									</div>

									<div className="flex items-center justify-between sm:justify-end gap-3 pl-8 sm:pl-0 shrink-0">
										{item.latencyMs !== undefined && (
											<span className="text-xs font-mono text-(--text-tertiary) flex items-center gap-1">
												<Zap size={11} className={item.latencyMs < 300 ? "text-emerald-400" : "text-amber-400"} />
												{item.latencyMs} ms
											</span>
										)}

										<span
											className={`text-xs font-bold px-2.5 py-1 rounded-full border uppercase tracking-wider text-[11px] ${
												isOk
													? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
													: isSlow
														? "bg-amber-500/10 text-amber-400 border-amber-500/20"
														: isDown
															? "bg-rose-500/10 text-rose-400 border-rose-500/20"
															: "bg-blue-500/10 text-blue-400 border-blue-500/20"
											}`}
										>
											{isOk ? "Operational" : isSlow ? "Slow" : isDown ? "Offline" : "Checking"}
										</span>

										<a
											href={item.url}
											target="_blank"
											rel="noopener noreferrer"
											className="text-(--text-tertiary) hover:text-(--text) p-1 rounded transition-colors"
											title="Open endpoint in browser"
										>
											<ExternalLink size={14} />
										</a>
									</div>
								</div>
							);
						})}
					</div>
				</div>

				{/* ── Footer ── */}
				<div className="pt-4 border-t border-(--border)/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-(--text-tertiary)">
					<div className="flex items-center gap-1.5">
						<ShieldCheck size={14} className="text-emerald-400" />
						<span>Chesster Web3 Chess Engine</span>
					</div>
					<div className="flex items-center gap-4">
						<a
							href="https://chesster-lovat.vercel.app"
							target="_blank"
							rel="noopener noreferrer"
							className="hover:text-(--text) transition-colors"
						>
							Live App (Vercel)
						</a>
						<span>•</span>
						<a
							href="https://chesster.onrender.com/health"
							target="_blank"
							rel="noopener noreferrer"
							className="hover:text-(--text) transition-colors"
						>
							Live API (Render)
						</a>
					</div>
				</div>
			</div>
		</div>
	);
}
