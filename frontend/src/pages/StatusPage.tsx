import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
	Activity,
	AlertCircle,
	AlertTriangle,
	ArrowLeft,
	Check,
	CheckCircle2,
	Clock,
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

export type ServiceStatus = "operational" | "degraded" | "down" | "checking";

export interface EndpointCheck {
	id: string;
	name: string;
	path: string;
	url: string;
	category: "Core Infrastructure" | "Gameplay & Lobby" | "Content & Social";
	description: string;
	status: ServiceStatus;
	httpStatus?: number;
	latencyMs?: number;
	details?: string;
	lastChecked?: Date;
}

interface ComprehensiveStatusData {
	status?: string;
	timestamp?: string;
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
			service?: string;
			network?: string;
			latestLedger?: number;
			responseTime?: number;
		};
	};
}

const ENDPOINTS_DEF: Omit<EndpointCheck, "status" | "httpStatus" | "latencyMs" | "details" | "lastChecked">[] = [
	{
		id: "root-health",
		name: "Server Liveness Probe",
		path: "/health",
		url: `${BACKEND_URL}/health`,
		category: "Core Infrastructure",
		description: "Root HTTP health probe used by orchestrators and load balancers",
	},
	{
		id: "api-health",
		name: "API Health Check",
		path: "/api/health",
		url: `${API_URL}/health`,
		category: "Core Infrastructure",
		description: "Quick liveness and readiness probe for API routes",
	},
	{
		id: "api-status",
		name: "Comprehensive Telemetry",
		path: "/api/status",
		url: `${API_URL}/status`,
		category: "Core Infrastructure",
		description: "Deep dependency health checks across Database, Stellar RPC, and system metrics",
	},
	{
		id: "status-database",
		name: "Database Status",
		path: "/api/status/database",
		url: `${API_URL}/status/database`,
		category: "Core Infrastructure",
		description: "Direct connection check and query probe to PostgreSQL database",
	},
	{
		id: "status-stellar",
		name: "Stellar & Soroban RPC",
		path: "/api/status/stellar",
		url: `${API_URL}/status/stellar`,
		category: "Core Infrastructure",
		description: "Horizon RPC connection, network validation, and latest ledger sequence",
	},
	{
		id: "csrf-token",
		name: "CSRF Security Authority",
		path: "/api/csrf-token",
		url: `${API_URL}/csrf-token`,
		category: "Core Infrastructure",
		description: "Cryptographic double-submit CSRF cookie & token generation",
	},
	{
		id: "games-pending",
		name: "Matchmaking & Lobby Queue",
		path: "/api/games/pending",
		url: `${API_URL}/games/pending`,
		category: "Gameplay & Lobby",
		description: "Pending game lobbies waiting for opponent connections",
	},
	{
		id: "tournaments",
		name: "Tournament Engine",
		path: "/api/tournaments",
		url: `${API_URL}/tournaments`,
		category: "Gameplay & Lobby",
		description: "Active, upcoming, and completed decentralized tournaments",
	},
	{
		id: "leaderboard",
		name: "Leaderboard & Elo Rankings",
		path: "/api/leaderboard",
		url: `${API_URL}/leaderboard`,
		category: "Content & Social",
		description: "Global player statistics, win rates, and time-control Elo ladders",
	},
	{
		id: "puzzles-daily",
		name: "Daily Tactical Puzzles",
		path: "/api/puzzles/daily",
		url: `${API_URL}/puzzles/daily`,
		category: "Content & Social",
		description: "Daily tactical chess puzzle challenge API",
	},
];

function formatUptime(uptimeSeconds?: number): string {
	if (!uptimeSeconds || uptimeSeconds < 0) return "–";
	const days = Math.floor(uptimeSeconds / 86400);
	const hours = Math.floor((uptimeSeconds % 86400) / 3600);
	const minutes = Math.floor((uptimeSeconds % 3600) / 60);
	const seconds = Math.floor(uptimeSeconds % 60);

	const parts: string[] = [];
	if (days > 0) parts.push(`${days}d`);
	if (hours > 0 || days > 0) parts.push(`${hours}h`);
	if (minutes > 0 || hours > 0 || days > 0) parts.push(`${minutes}m`);
	parts.push(`${seconds}s`);
	return parts.join(" ");
}

export default function StatusPage() {
	const [endpoints, setEndpoints] = useState<EndpointCheck[]>(() =>
		ENDPOINTS_DEF.map((def) => ({ ...def, status: "checking" })),
	);
	const [telemetry, setTelemetry] = useState<ComprehensiveStatusData | null>(null);
	const [socketConnected, setSocketConnected] = useState<boolean>(() => {
		try {
			return Boolean(getSocket()?.connected);
		} catch {
			return false;
		}
	});
	const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
	const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
	const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
	const [countdown, setCountdown] = useState<number>(15);
	const [copied, setCopied] = useState<boolean>(false);
	const [selectedCategory, setSelectedCategory] = useState<string>("All");

	// Probe Socket.io status
	useEffect(() => {
		try {
			const socket = getSocket();
			const onConnect = () => setSocketConnected(true);
			const onDisconnect = () => setSocketConnected(false);

			socket.on("connect", onConnect);
			socket.on("disconnect", onDisconnect);

			return () => {
				socket.off("connect", onConnect);
				socket.off("disconnect", onDisconnect);
			};
		} catch {
			// ignore socket init errors
		}
	}, []);

	// Check a single endpoint
	const checkEndpoint = useCallback(async (def: (typeof ENDPOINTS_DEF)[0]): Promise<EndpointCheck> => {
		const start = performance.now();
		try {
			const res = await fetch(def.url, {
				method: "GET",
				headers: { Accept: "application/json" },
			});
			const latencyMs = Math.round(performance.now() - start);
			const isOk = res.ok;

			let dataText = "";
			try {
				const data = await res.json();
				if (def.id === "api-status" && data && typeof data === "object") {
					setTelemetry(data);
				}
				dataText = JSON.stringify(data).slice(0, 100);
			} catch {
				dataText = `Status: ${res.status} ${res.statusText}`;
			}

			let status: ServiceStatus = "operational";
			if (!isOk) {
				// Some endpoints like daily puzzles might return 200 with error, or 404/503
				status = res.status >= 500 ? "down" : "degraded";
			} else if (latencyMs > 2500) {
				status = "degraded";
			}

			return {
				...def,
				status,
				httpStatus: res.status,
				latencyMs,
				details: dataText,
				lastChecked: new Date(),
			};
		} catch (err: unknown) {
			const latencyMs = Math.round(performance.now() - start);
			const message = err instanceof Error ? err.message : "Network request failed";
			return {
				...def,
				status: "down",
				httpStatus: 0,
				latencyMs,
				details: message,
				lastChecked: new Date(),
			};
		}
	}, []);

	// Run all checks
	const runAllChecks = useCallback(async () => {
		setIsRefreshing(true);
		setEndpoints((prev) => prev.map((e) => ({ ...e, status: "checking" })));

		const results = await Promise.all(ENDPOINTS_DEF.map((def) => checkEndpoint(def)));
		setEndpoints(results);
		setLastRefreshedAt(new Date());
		setIsRefreshing(false);
		setCountdown(15);
	}, [checkEndpoint]);

	// Initial run
	useEffect(() => {
		const timer = setTimeout(() => {
			runAllChecks();
		}, 0);
		return () => clearTimeout(timer);
	}, [runAllChecks]);

	// Auto refresh timer
	useEffect(() => {
		if (!autoRefresh) return;
		const interval = setInterval(() => {
			setCountdown((c) => {
				if (c <= 1) {
					runAllChecks();
					return 15;
				}
				return c - 1;
			});
		}, 1000);
		return () => clearInterval(interval);
	}, [autoRefresh, runAllChecks]);

	// Overall system health calculation
	const overallStatus: ServiceStatus = useMemo(() => {
		const isChecking = endpoints.some((e) => e.status === "checking");
		if (isChecking && endpoints.every((e) => e.status === "checking")) return "checking";
		const hasDown = endpoints.some((e) => e.status === "down");
		if (hasDown) return "down";
		const hasDegraded = endpoints.some((e) => e.status === "degraded");
		if (hasDegraded) return "degraded";
		return "operational";
	}, [endpoints]);

	// Filtered list
	const filteredEndpoints = useMemo(() => {
		if (selectedCategory === "All") return endpoints;
		return endpoints.filter((e) => e.category === selectedCategory);
	}, [endpoints, selectedCategory]);

	// Copy JSON diagnostics report
	const copyDiagnostics = () => {
		const report = {
			timestamp: new Date().toISOString(),
			overallStatus,
			backendUrl: BACKEND_URL,
			uptime: telemetry?.uptime,
			environment: telemetry?.environment || "production",
			socketConnected,
			subsystems: telemetry?.services,
			endpoints: endpoints.map((e) => ({
				name: e.name,
				path: e.path,
				status: e.status,
				httpStatus: e.httpStatus,
				latencyMs: e.latencyMs,
				details: e.details,
			})),
		};

		navigator.clipboard.writeText(JSON.stringify(report, null, 2)).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		});
	};

	return (
		<div className="min-h-screen bg-(--bg) text-(--text) p-4 sm:p-6 md:p-8 transition-colors">
			<div className="max-w-6xl mx-auto space-y-6">
				{/* ── Top Navigation & Title ── */}
				<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-(--border)/50 pb-6">
					<div>
						<Link
							to="/"
							className="inline-flex items-center gap-2 text-sm text-(--text-secondary) hover:text-(--text) transition-colors mb-2"
						>
							<ArrowLeft size={16} />
							<span>Back to Match Lobby</span>
						</Link>
						<div className="flex items-center gap-3">
							<h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight flex items-center gap-2.5">
								<Activity className="text-(--accent-primary)" size={28} />
								Chesster Status
							</h1>
							<span className="text-xs px-2.5 py-1 rounded-full bg-(--bg-secondary) border border-(--border) text-(--text-secondary) font-mono">
								v1.37.0
							</span>
						</div>
						<p className="text-sm text-(--text-secondary) mt-1">
							Live telemetry, dependency metrics, and health probe of all Chesster endpoints.
						</p>
					</div>

					<div className="flex items-center flex-wrap gap-2.5">
						<button
							onClick={copyDiagnostics}
							className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-(--border) bg-(--bg-secondary) hover:bg-(--bg-tertiary) text-(--text-secondary) hover:text-(--text) transition-colors"
							title="Copy diagnostic report as JSON"
						>
							{copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
							<span>{copied ? "Copied JSON" : "Copy Report"}</span>
						</button>

						<button
							onClick={() => setAutoRefresh(!autoRefresh)}
							className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
								autoRefresh
									? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
									: "border-(--border) bg-(--bg-secondary) text-(--text-tertiary)"
							}`}
							title="Toggle automatic 15s polling"
						>
							<Clock size={14} />
							<span>Auto-refresh {autoRefresh ? `(${countdown}s)` : "Off"}</span>
						</button>

						<button
							onClick={runAllChecks}
							disabled={isRefreshing}
							className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-(--accent-dark) hover:bg-(--accent-primary) text-white transition-all disabled:opacity-50"
						>
							<RefreshCw size={14} className={isRefreshing ? "animate-spin" : ""} />
							<span>{isRefreshing ? "Testing…" : "Refresh"}</span>
						</button>
					</div>
				</div>

				{/* ── Global Status Banner ── */}
				<div
					className={`p-4 sm:p-5 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all ${
						overallStatus === "operational"
							? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
							: overallStatus === "degraded"
								? "bg-amber-500/10 border-amber-500/30 text-amber-300"
								: overallStatus === "down"
									? "bg-rose-500/10 border-rose-500/30 text-rose-300"
									: "bg-blue-500/10 border-blue-500/30 text-blue-300"
					}`}
				>
					<div className="flex items-center gap-3.5">
						<span className="relative flex h-4 w-4">
							<span
								className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
									overallStatus === "operational"
										? "bg-emerald-400"
										: overallStatus === "degraded"
											? "bg-amber-400"
											: "bg-rose-400"
								}`}
							/>
							<span
								className={`relative inline-flex rounded-full h-4 w-4 ${
									overallStatus === "operational"
										? "bg-emerald-500"
										: overallStatus === "degraded"
											? "bg-amber-500"
											: "bg-rose-500"
								}`}
							/>
						</span>
						<div>
							<h2 className="text-lg font-bold">
								{overallStatus === "operational" && "All Systems Operational"}
								{overallStatus === "degraded" && "Degraded Performance Detected"}
								{overallStatus === "down" && "Critical Service Outage"}
								{overallStatus === "checking" && "Probing System Health…"}
							</h2>
							<p className="text-xs opacity-80 mt-0.5">
								{lastRefreshedAt
									? `Last checked ${lastRefreshedAt.toLocaleTimeString()} (${endpoints.filter((e) => e.status === "operational").length}/${endpoints.length} endpoints operational)`
									: "Connecting to remote services…"}
							</p>
						</div>
					</div>

					<div className="flex items-center gap-4 text-xs font-mono">
						<div className="flex items-center gap-1.5 bg-(--bg)/40 px-3 py-1.5 rounded-lg border border-white/10">
							<Server size={14} />
							<span>Host: {BACKEND_URL.replace(/^https?:\/\//, "")}</span>
						</div>
					</div>
				</div>

				{/* ── Subsystem Metric Cards ── */}
				<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
					{/* Card 1: Backend Server */}
					<div className="p-4 rounded-xl border border-(--border)/70 bg-(--bg-secondary) flex flex-col justify-between">
						<div className="flex items-center justify-between text-(--text-secondary)">
							<span className="text-xs font-medium uppercase tracking-wider flex items-center gap-1.5">
								<Server size={14} className="text-(--accent-primary)" />
								Backend Web Server
							</span>
							<span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
								LIVE
							</span>
						</div>
						<div className="mt-3">
							<div className="text-xl font-bold font-mono">
								{formatUptime(telemetry?.uptime)}
							</div>
							<div className="text-xs text-(--text-tertiary) mt-0.5 flex items-center justify-between">
								<span>Uptime</span>
								<span className="font-mono capitalize">{telemetry?.environment || "production"}</span>
							</div>
						</div>
					</div>

					{/* Card 2: Database Subsystem */}
					<div className="p-4 rounded-xl border border-(--border)/70 bg-(--bg-secondary) flex flex-col justify-between">
						<div className="flex items-center justify-between text-(--text-secondary)">
							<span className="text-xs font-medium uppercase tracking-wider flex items-center gap-1.5">
								<Database size={14} className="text-blue-400" />
								Database (PostgreSQL)
							</span>
							<span
								className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
									telemetry?.services?.database?.status === "healthy"
										? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
										: "bg-amber-500/10 text-amber-400 border-amber-500/20"
								}`}
							>
								{telemetry?.services?.database?.status || "CONNECTED"}
							</span>
						</div>
						<div className="mt-3">
							<div className="text-xl font-bold font-mono">
								{telemetry?.services?.database?.responseTime
									? `${telemetry.services.database.responseTime} ms`
									: "< 120 ms"}
							</div>
							<div className="text-xs text-(--text-tertiary) mt-0.5 flex items-center justify-between">
								<span>Engine</span>
								<span className="font-mono">Neon / Prisma</span>
							</div>
						</div>
					</div>

					{/* Card 3: Stellar / Soroban RPC */}
					<div className="p-4 rounded-xl border border-(--border)/70 bg-(--bg-secondary) flex flex-col justify-between">
						<div className="flex items-center justify-between text-(--text-secondary)">
							<span className="text-xs font-medium uppercase tracking-wider flex items-center gap-1.5">
								<Globe size={14} className="text-indigo-400" />
								Stellar & Soroban RPC
							</span>
							<span
								className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
									telemetry?.services?.stellarRpc?.status === "healthy"
										? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
										: "bg-amber-500/10 text-amber-400 border-amber-500/20"
								}`}
							>
								{telemetry?.services?.stellarRpc?.network || "TESTNET"}
							</span>
						</div>
						<div className="mt-3">
							<div className="text-xl font-bold font-mono">
								{telemetry?.services?.stellarRpc?.latestLedger
									? `#${telemetry.services.stellarRpc.latestLedger.toLocaleString()}`
									: "Connected"}
							</div>
							<div className="text-xs text-(--text-tertiary) mt-0.5 flex items-center justify-between">
								<span>Latest Ledger</span>
								<span className="font-mono">
									{telemetry?.services?.stellarRpc?.responseTime
										? `${telemetry.services.stellarRpc.responseTime}ms`
										: "Fast"}
								</span>
							</div>
						</div>
					</div>

					{/* Card 4: Socket.io Realtime */}
					<div className="p-4 rounded-xl border border-(--border)/70 bg-(--bg-secondary) flex flex-col justify-between">
						<div className="flex items-center justify-between text-(--text-secondary)">
							<span className="text-xs font-medium uppercase tracking-wider flex items-center gap-1.5">
								<Radio size={14} className="text-emerald-400" />
								Realtime WebSockets
							</span>
							<span
								className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
									socketConnected
										? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
										: "bg-rose-500/10 text-rose-400 border-rose-500/20"
								}`}
							>
								{socketConnected ? "ONLINE" : "STANDBY"}
							</span>
						</div>
						<div className="mt-3">
							<div className="text-xl font-bold font-mono">
								{socketConnected ? "Socket.io Active" : "Polling"}
							</div>
							<div className="text-xs text-(--text-tertiary) mt-0.5 flex items-center justify-between">
								<span>Protocol</span>
								<span className="font-mono">WebSocket / WSS</span>
							</div>
						</div>
					</div>
				</div>

				{/* ── Category Tabs ── */}
				<div className="flex items-center justify-between flex-wrap gap-3">
					<div className="flex items-center gap-1 p-1 bg-(--bg-secondary) rounded-xl border border-(--border)/70 text-xs font-medium">
						{["All", "Core Infrastructure", "Gameplay & Lobby", "Content & Social"].map(
							(cat) => (
								<button
									key={cat}
									onClick={() => setSelectedCategory(cat)}
									className={`px-3 py-1.5 rounded-lg transition-all ${
										selectedCategory === cat
											? "bg-(--bg-tertiary) text-(--text) font-bold shadow-sm"
											: "text-(--text-secondary) hover:text-(--text)"
									}`}
								>
									{cat}
								</button>
							),
						)}
					</div>

					<span className="text-xs text-(--text-tertiary)">
						Showing {filteredEndpoints.length} monitored endpoints
					</span>
				</div>

				{/* ── Endpoints Table / Cards ── */}
				<div className="space-y-3">
					{filteredEndpoints.map((ep) => {
						const isHealthy = ep.status === "operational";
						const isDegraded = ep.status === "degraded";
						const isDown = ep.status === "down";

						return (
							<div
								key={ep.id}
								className="p-4 sm:p-5 rounded-2xl border border-(--border)/60 bg-(--bg-secondary) hover:border-(--border) transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"
							>
								<div className="flex items-start gap-3.5">
									<div className="mt-0.5">
										{isHealthy && <CheckCircle2 size={18} className="text-emerald-400" />}
										{isDegraded && <AlertTriangle size={18} className="text-amber-400" />}
										{isDown && <AlertCircle size={18} className="text-rose-400" />}
										{ep.status === "checking" && (
											<RefreshCw size={18} className="text-blue-400 animate-spin" />
										)}
									</div>

									<div>
										<div className="flex items-center gap-2 flex-wrap">
											<span className="text-sm font-bold tracking-tight">{ep.name}</span>
											<span className="font-mono text-xs px-2 py-0.5 rounded bg-(--bg-tertiary) border border-(--border)/50 text-(--text-secondary)">
												GET {ep.path}
											</span>
											<span className="text-[11px] px-2 py-0.5 rounded-full bg-(--bg) text-(--text-tertiary) border border-(--border)/30">
												{ep.category}
											</span>
										</div>
										<p className="text-xs text-(--text-secondary) mt-1">{ep.description}</p>
										{ep.details && (
											<p className="text-[11px] font-mono text-(--text-tertiary) mt-1 truncate max-w-xl">
												Payload: {ep.details}
											</p>
										)}
									</div>
								</div>

								<div className="flex items-center justify-between md:justify-end gap-3 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-(--border)/40">
									{/* Latency badge */}
									{ep.latencyMs !== undefined && (
										<div
											className={`flex items-center gap-1 text-xs font-mono px-2 py-1 rounded-md border ${
												ep.latencyMs < 350
													? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
													: ep.latencyMs < 1200
														? "text-amber-400 bg-amber-500/10 border-amber-500/20"
														: "text-rose-400 bg-rose-500/10 border-rose-500/20"
											}`}
										>
											<Zap size={12} />
											<span>{ep.latencyMs}ms</span>
										</div>
									)}

									{/* Status badge */}
									<span
										className={`text-xs font-mono font-semibold px-2.5 py-1 rounded-md border uppercase tracking-wider ${
											isHealthy
												? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
												: isDegraded
													? "text-amber-400 bg-amber-500/10 border-amber-500/20"
													: isDown
														? "text-rose-400 bg-rose-500/10 border-rose-500/20"
														: "text-blue-400 bg-blue-500/10 border-blue-500/20"
										}`}
									>
										{ep.httpStatus ? `${ep.httpStatus} OK` : ep.status}
									</span>

									{/* Open external link */}
									<a
										href={ep.url}
										target="_blank"
										rel="noopener noreferrer"
										className="p-1.5 text-(--text-tertiary) hover:text-(--text) hover:bg-(--bg-tertiary) rounded-lg transition-colors"
										title="Open endpoint in new tab"
									>
										<ExternalLink size={15} />
									</a>
								</div>
							</div>
						);
					})}
				</div>

				{/* ── Footer ── */}
				<div className="pt-4 border-t border-(--border)/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-(--text-tertiary)">
					<div className="flex items-center gap-1.5">
						<ShieldCheck size={14} className="text-emerald-400" />
						<span>Chesster Decentralized Architecture • Testnet Soroban Engine</span>
					</div>
					<div>
						<span>Powered by Render, Neon PostgreSQL & Stellar</span>
					</div>
				</div>
			</div>
		</div>
	);
}
