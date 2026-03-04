import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useGameStore } from "../store/gameStore";
import { useToastStore } from "../store/toastStore";
import {
	AppKitButton,
	useAppKitAccount,
	useAppKitProvider,
} from "@reown/appkit/react";
import { ethers } from "ethers";
import { api } from "../api/gameApi";
import { Clock, Users, ChevronRight } from "lucide-react";

const ESCROW_ADDRESS = import.meta.env.VITE_ESCROW_CONTRACT_ADDRESS || "";
const BACKEND_URL =
	import.meta.env.VITE_BACKEND_URL || "http://localhost:3000/";

// Minimal ABI for the ETH escrow — players call these directly
const ESCROW_ETH_ABI = [
	"function createMatch(bytes32 gameCode) external payable",
	"function joinMatch(bytes32 gameCode) external payable",
];

// ── Time control options ───────────────────────────────────────────────────────
const TIME_CONTROLS = [
	{ label: "5 min", seconds: 300, tag: "Blitz" },
	{ label: "10 min", seconds: 600, tag: "Rapid" },
	{ label: "15 min", seconds: 900, tag: "Rapid" },
	{ label: "30 min", seconds: 1800, tag: "Classical" },
	{ label: "45 min", seconds: 2700, tag: "Classical" },
	{ label: "60 min", seconds: 3600, tag: "Classical" },
];

type Step =
	| "idle"
	| "creating"
	| "depositing"
	| "fetching"
	| "join-confirming"
	| "joining";

interface WagerInfo {
	wagerAmount: string;
}

interface PendingGame {
	game_code: string;
	created_at: string;
	wager_amount: number | null;
	time_control_seconds: number | null;
	player_white_address: string | null;
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

// ── Skeleton ──────────────────────────────────────────────────────────────────
function LobbySkeleton() {
	return (
		<div className="h-svh w-screen flex flex-col items-center justify-center bg-(--bg) p-4 gap-6">
			<div className="flex flex-col items-center gap-3 w-full max-w-xs">
				<div className="h-14 w-40 rounded-2xl bg-(--bg-secondary) animate-pulse" />
				<div className="h-4 w-56 rounded-lg bg-(--bg-secondary) animate-pulse" />
			</div>
			<div className="flex flex-col gap-3 w-full max-w-xs">
				<div className="h-13 rounded-2xl bg-(--bg-secondary) animate-pulse" />
				<div className="h-px bg-(--border)" />
				<div className="h-12 rounded-xl bg-(--bg-secondary) animate-pulse" />
				<div className="h-13 rounded-2xl bg-(--bg-secondary) animate-pulse" />
			</div>
		</div>
	);
}

// ── Loading overlay ───────────────────────────────────────────────────────────
function LoadingOverlay({
	step,
	wagerEnabled,
}: {
	step: Step;
	wagerEnabled: boolean;
}) {
	const labels: Partial<Record<Step, { title: string; sub?: string }>> = {
		creating: {
			title: "Creating game\u2026",
			sub: wagerEnabled ? "Setting up the game on the server" : undefined,
		},
		depositing: {
			title: "Confirm in wallet\u2026",
			sub: "Send ETH to the escrow contract",
		},
		fetching: { title: "Checking game\u2026" },
		joining: {
			title: wagerEnabled
				? "Joining game on-chain\u2026"
				: "Joining game\u2026",
			sub: wagerEnabled ? "Locking ETH into escrow contract" : undefined,
		},
	};

	const info = labels[step];
	if (!info) return null;

	return (
		<div className="absolute inset-0 bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm">
			<div className="bg-(--bg-secondary) border border-(--border) rounded-2xl px-8 py-7 flex flex-col items-center gap-3 shadow-2xl max-w-xs w-full mx-4">
				<Spinner size={32} />
				<p className="font-semibold text-center">{info.title}</p>
				{info.sub && (
					<p className="text-xs text-(--text-tertiary) text-center">
						{info.sub}
					</p>
				)}
				{wagerEnabled && (step === "depositing" || step === "joining") && (
					<div className="flex items-center gap-2 mt-1">
						<div
							className={`flex items-center gap-1.5 text-xs ${
								step === "depositing"
									? "text-(--accent-primary) font-semibold"
									: "text-green-500"
							}`}
						>
							{step === "depositing" ? (
								<Spinner size={10} />
							) : (
								<span className="text-green-500">&#10003;</span>
							)}
							Deposit
						</div>
						<div className="w-4 h-px bg-(--border)" />
						<div
							className={`flex items-center gap-1.5 text-xs ${
								step === "joining"
									? "text-(--accent-primary) font-semibold"
									: "text-(--text-tertiary)"
							}`}
						>
							{step === "joining" && <Spinner size={10} />}
							Join
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

// ── Wager confirm panel ───────────────────────────────────────────────────────
function WagerConfirmPanel({
	info,
	onConfirm,
	onCancel,
	isDepositing,
}: {
	info: WagerInfo;
	onConfirm: () => void;
	onCancel: () => void;
	isDepositing: boolean;
}) {
	return (
		<div className="h-svh w-screen flex flex-col items-center justify-center bg-(--bg) p-4">
			<div className="absolute top-4 right-4">
				<AppKitButton />
			</div>
			<div className="w-full max-w-xs bg-(--bg-secondary) border border-(--border) rounded-2xl p-5 flex flex-col gap-4 shadow-xl">
				<div className="text-center flex flex-col gap-1">
					<div className="text-3xl mb-1">&#9888;&#65039;</div>
					<h2 className="font-bold text-lg">Wagered Game</h2>
					<p className="text-sm text-(--text-secondary)">
						This game requires a wager of
					</p>
					<p className="text-2xl font-bold">
						{info.wagerAmount}{" "}
						<span className="text-base font-semibold text-(--text-secondary)">
							ETH
						</span>
					</p>
				</div>

				<div className="bg-(--bg) rounded-xl p-3 flex flex-col gap-1 text-xs text-(--text-tertiary)">
					<p>&#8226; Winner takes the pot</p>
					<p>&#8226; Draws refund both players in full</p>
					<p>&#8226; Your wallet will ask to confirm the ETH transfer</p>
				</div>

				<button
					onClick={onConfirm}
					disabled={isDepositing}
					className="w-full py-3 font-bold bg-(--accent-dark) hover:bg-(--accent-primary) disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-all flex items-center justify-center gap-2"
				>
					{isDepositing ? (
						<>
							<Spinner size={16} />
							Depositing&#8230;
						</>
					) : (
						"Send ETH & Join"
					)}
				</button>
				<button
					onClick={onCancel}
					disabled={isDepositing}
					className="w-full py-2.5 text-sm text-(--text-secondary) hover:text-(--text) bg-(--bg-tertiary) rounded-xl transition-all disabled:opacity-40"
				>
					Cancel
				</button>
			</div>
		</div>
	);
}

// ── Pending games list ────────────────────────────────────────────────────────
function PendingGamesList({
	onJoin,
	disabled,
}: {
	onJoin: (code: string) => void;
	disabled: boolean;
}) {
	const [games, setGames] = useState<PendingGame[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let active = true;
		const load = async () => {
			try {
				const res = await api.getPendingGames();
				if (active && res.success) setGames(res.data);
			} catch {
				// silently ignore
			} finally {
				if (active) setLoading(false);
			}
		};
		load();
		const id = setInterval(load, 15000);
		return () => {
			active = false;
			clearInterval(id);
		};
	}, []);

	if (loading || games.length === 0) return null;

	const fmtTime = (s: number | null) => {
		if (!s) return "10 min";
		const m = Math.round(s / 60);
		return `${m} min`;
	};

	return (
		<div className="w-full flex flex-col gap-2">
			<div className="flex items-center gap-2 text-xs text-(--text-tertiary) px-1">
				<Users size={12} />
				<span>Open games waiting for a player</span>
				<span className="ml-auto bg-(--bg-tertiary) rounded-full px-1.5 py-0.5 font-mono text-[10px]">
					{games.length}
				</span>
			</div>
			<div className="flex flex-col gap-1.5">
				{games.map((g) => (
					<div
						key={g.game_code}
						className="flex items-center justify-between px-3 py-2.5 bg-(--bg-secondary) border border-(--border) rounded-xl gap-2"
					>
						<div className="flex items-center gap-2 min-w-0">
							<div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-sm shrink-0">
								&#9812;
							</div>
							<div className="flex flex-col min-w-0">
								<span className="font-mono text-xs font-bold tracking-widest truncate">
									{g.game_code}
								</span>
								<div className="flex items-center gap-1.5 text-[10px] text-(--text-tertiary)">
									<Clock size={9} />
									<span>{fmtTime(g.time_control_seconds)}</span>
									{g.wager_amount && (
										<>
											<span>&#183;</span>
											<span className="text-yellow-400 font-semibold">
												{g.wager_amount} ETH
											</span>
										</>
									)}
								</div>
							</div>
						</div>
						<button
							onClick={() => onJoin(g.game_code)}
							disabled={disabled}
							className="flex items-center gap-1 px-2.5 py-1.5 bg-(--accent-dark) hover:bg-(--accent-primary) disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-xs font-semibold transition-colors shrink-0"
						>
							Join
							<ChevronRight size={11} />
						</button>
					</div>
				))}
			</div>
			<p className="text-[10px] text-(--text-tertiary) text-center px-1 leading-relaxed">
				Games pending for over 1 hour are automatically cancelled and refunded.
			</p>
		</div>
	);
}

// ── Main component ────────────────────────────────────────────────────────────
export default function GameLobby() {
	const [gameCode, setGameCode] = useState("");
	const [wagerEnabled, setWagerEnabled] = useState(false);
	const [wagerAmount, setWagerAmount] = useState("");
	const [selectedTimeControl, setSelectedTimeControl] = useState(
		TIME_CONTROLS[3],
	); // 10 min default
	const [step, setStep] = useState<Step>("idle");
	const [pendingWager, setPendingWager] = useState<WagerInfo | null>(null);

	const { createGame, joinGame } = useGameStore();
	const { addToast } = useToastStore();
	const navigate = useNavigate();
	const { address, isConnected } = useAppKitAccount();
	const { walletProvider } = useAppKitProvider("eip155");

	const isLoading = step !== "idle";

	// ── Deposit ETH to escrow contract ────────────────────────────────────────
	const depositETH = async (
		fnName: "createMatch" | "joinMatch",
		code: string,
		amount: string,
	) => {
		if (!walletProvider) throw new Error("Wallet not connected");
		if (!ESCROW_ADDRESS)
			throw new Error(
				"Escrow contract address not configured (set VITE_ESCROW_CONTRACT_ADDRESS)",
			);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const provider = new ethers.BrowserProvider(walletProvider as any);
		const signer = await provider.getSigner();
		const contract = new ethers.Contract(
			ESCROW_ADDRESS,
			ESCROW_ETH_ABI,
			signer,
		);
		const tx = await contract[fnName](ethers.id(code), {
			value: ethers.parseEther(amount),
		});
		await tx.wait();
	};

	// ── Create game ───────────────────────────────────────────────────────────
	const handleCreateGame = async () => {
		if (!isConnected || !address) {
			addToast("Please connect your wallet first", "error");
			return;
		}

		if (wagerEnabled) {
			if (!wagerAmount || parseFloat(wagerAmount) <= 0) {
				addToast("Enter a valid wager amount", "error");
				return;
			}
			if (!ESCROW_ADDRESS) {
				addToast(
					"Escrow contract address not configured (set VITE_ESCROW_CONTRACT_ADDRESS)",
					"error",
				);
				return;
			}

			setStep("creating");
			let createdGameCode: string;
			try {
				const data = await api.createGame(
					"chess",
					address,
					wagerAmount,
					selectedTimeControl.seconds,
				);
				if (!data.success)
					throw new Error(data.error || "Failed to create game");
				createdGameCode = data.data.game_code;
			} catch (err: unknown) {
				setStep("idle");
				const msg =
					err instanceof Error ? err.message : "Failed to create game";
				addToast(msg, "error");
				return;
			}

			setStep("depositing");
			try {
				await depositETH("createMatch", createdGameCode, wagerAmount);
			} catch (err: unknown) {
				setStep("idle");
				const msg = err instanceof Error ? err.message : "ETH deposit failed";
				addToast(
					msg.includes("rejected") || msg.includes("denied")
						? "Deposit cancelled"
						: msg,
					"error",
				);
				return;
			}

			try {
				await joinGame(createdGameCode, "white", address);
				navigate(`/${createdGameCode}`);
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : "Something went wrong";
				addToast(msg, "error");
			} finally {
				setStep("idle");
			}
		} else {
			setStep("creating");
			try {
				await createGame(address, undefined, selectedTimeControl.seconds);
				const code = useGameStore.getState().gameCode;
				if (code) navigate(`/${code}`);
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : "Something went wrong";
				addToast(msg, "error");
			} finally {
				setStep("idle");
			}
		}
	};

	// ── Join game by code ─────────────────────────────────────────────────────
	const handleJoinByCode = async (code: string) => {
		if (!isConnected || !address) {
			addToast("Please connect your wallet first", "error");
			return;
		}
		const trimmed = code.trim().toUpperCase();
		if (!trimmed) return;

		setStep("fetching");
		setGameCode(trimmed);
		let wagerInfo: { wager_amount?: number | null } = {};
		try {
			const res = await fetch(`${BACKEND_URL}api/games/${trimmed}`);
			const json = await res.json();
			if (!json.success) throw new Error(json.error || "Game not found");
			wagerInfo = json.data;
		} catch (err: unknown) {
			setStep("idle");
			const msg = err instanceof Error ? err.message : "Game not found";
			addToast(msg, "error");
			return;
		}

		if (wagerInfo.wager_amount) {
			setPendingWager({ wagerAmount: wagerInfo.wager_amount.toString() });
			setStep("join-confirming");
			return;
		}

		setStep("joining");
		try {
			await joinGame(trimmed, "black", address);
			navigate(`/${trimmed}`);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : "Something went wrong";
			addToast(msg, "error");
		} finally {
			setStep("idle");
		}
	};

	const handleJoinGame = () => handleJoinByCode(gameCode);

	// ── Deposit ETH & join (after wager confirmation) ─────────────────────────
	const handleDepositAndJoin = async () => {
		if (!pendingWager || !address) return;

		setStep("depositing");
		try {
			await depositETH("joinMatch", gameCode, pendingWager.wagerAmount);
		} catch (err: unknown) {
			setStep("join-confirming");
			const msg = err instanceof Error ? err.message : "ETH deposit failed";
			addToast(
				msg.includes("rejected") || msg.includes("denied")
					? "Deposit cancelled"
					: msg,
				"error",
			);
			return;
		}

		setStep("joining");
		try {
			await joinGame(gameCode, "black", address);
			navigate(`/${gameCode}`);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : "Something went wrong";
			addToast(msg, "error");
		} finally {
			setStep("idle");
			setPendingWager(null);
		}
	};

	// ── Show wager confirmation panel ─────────────────────────────────────────
	if (step === "join-confirming" && pendingWager) {
		return (
			<WagerConfirmPanel
				info={pendingWager}
				onConfirm={handleDepositAndJoin}
				onCancel={() => {
					setStep("idle");
					setPendingWager(null);
				}}
				isDepositing={false}
			/>
		);
	}

	if (step === "fetching" && !isLoading) {
		return <LobbySkeleton />;
	}

	// ── Main lobby ────────────────────────────────────────────────────────────
	return (
		<div className="min-h-svh w-screen overflow-y-auto flex flex-col items-center bg-(--bg) px-4 pt-9 pb-12 gap-8 relative">
			{isLoading && step !== "join-confirming" && (
				<LoadingOverlay
					step={step}
					wagerEnabled={wagerEnabled || !!pendingWager}
				/>
			)}

			<div className="fixed top-4 left-4 z-10">
				<h1 className="text-2xl font-bold tracking-tight">Chesster</h1>
			</div>

			{/* Wallet button */}
			<div className="fixed top-4 right-4 z-10">
				<AppKitButton />
			</div>

			{/* Logo */}
			<div className="flex flex-col items-center text-center pt-4">
				<p className="text-(--text-secondary) text-sm ">
					{isConnected
						? "Ready to play — create or join a game"
						: "Connect your wallet to play on-chain chess"}
				</p>
			</div>

			{/* ── Two-column layout ── */}
			<div className="w-full max-w-2xl grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
				{/* ── LEFT: Create game ── */}
				<div className="flex flex-col gap-3">
					<p className="text-xs font-semibold text-(--text-tertiary) uppercase tracking-widest px-1">
						Create a game
					</p>

					{/* Time control selector */}
					{isConnected && (
						<div className="flex flex-col gap-2 p-3 bg-(--bg-secondary) border border-(--border) rounded-xl">
							<div className="flex items-center gap-1.5 text-xs font-semibold text-(--text-tertiary) uppercase tracking-wider">
								<Clock size={11} />
								Game duration
							</div>
							<div className="grid grid-cols-3 gap-1.5">
								{TIME_CONTROLS.map((tc) => (
									<button
										key={tc.seconds}
										onClick={() => setSelectedTimeControl(tc)}
										className={`flex flex-col items-center py-2.5 px-1 rounded-lg border text-xs transition-all ${
											selectedTimeControl.seconds === tc.seconds
												? "border-(--accent-primary) bg-(--accent-dark)/20 text-white font-semibold"
												: "border-(--border) bg-(--bg) text-(--text-secondary) hover:border-(--accent-primary)/50"
										}`}
									>
										<span className="font-bold text-sm">{tc.label}</span>
										<span
											className={`text-[10px] mt-0.5 ${
												selectedTimeControl.seconds === tc.seconds
													? "text-(--accent-primary)"
													: "text-(--text-tertiary)"
											}`}
										>
											{tc.tag}
										</span>
									</button>
								))}
							</div>
						</div>
					)}

					{/* Wager toggle */}
					{isConnected && (
						<button
							onClick={() => setWagerEnabled((v) => !v)}
							className="flex items-center justify-between px-4 py-2.5 bg-(--bg-secondary) border border-(--border) rounded-xl w-full transition-colors hover:border-(--accent-primary)/50"
						>
							<span className="text-sm text-(--text-secondary)">
								{wagerEnabled ? "Wager enabled" : "Play with wager"}
							</span>
							<div
								className={`relative w-10 h-5 rounded-full transition-colors ${
									wagerEnabled ? "bg-(--accent-dark)" : "bg-(--bg-tertiary)"
								}`}
							>
								<div
									className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
										wagerEnabled ? "translate-x-5" : "translate-x-0.5"
									}`}
								/>
							</div>
						</button>
					)}

					{/* Wager settings */}
					{wagerEnabled && isConnected && (
						<div className="flex flex-col gap-2 p-3 bg-(--bg-secondary) border border-(--border) rounded-xl">
							<p className="text-xs font-semibold text-(--text-tertiary) uppercase tracking-wider">
								Wager amount
							</p>
							<div className="relative">
								<input
									type="number"
									placeholder="e.g. 0.01"
									value={wagerAmount}
									min="0"
									step="0.001"
									onChange={(e) => setWagerAmount(e.target.value)}
									className="w-full px-3 py-2 pr-14 text-sm border border-(--border) rounded-lg bg-(--bg) text-(--text) placeholder:text-(--text-tertiary) outline-none focus:ring-2 focus:ring-(--accent-primary)"
								/>
								<span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-(--text-tertiary) pointer-events-none">
									ETH
								</span>
							</div>
							<p className="text-xs text-(--text-tertiary) leading-relaxed">
								Winner takes the pot &#183; Draws refund both players
							</p>
						</div>
					)}

					{/* Create button */}
					<button
						onClick={handleCreateGame}
						disabled={isLoading || !isConnected}
						className="w-full px-6 py-3.5 text-base font-bold bg-(--accent-dark) hover:bg-(--accent-primary) disabled:opacity-40 disabled:cursor-not-allowed transition-all rounded-2xl shadow-lg active:scale-[0.98] flex items-center justify-center gap-2"
					>
						{step === "creating" ? (
							<>
								<Spinner size={16} />
								Creating&#8230;
							</>
						) : step === "depositing" && wagerEnabled ? (
							<>
								<Spinner size={16} />
								Confirm in wallet&#8230;
							</>
						) : wagerEnabled ? (
							"Create Game & Wager ETH"
						) : (
							"Create New Game"
						)}
					</button>
				</div>

				{/* ── Vertical divider (sm+) / horizontal divider (mobile) ── */}
				<div className="hidden sm:flex flex-col items-center self-stretch">
					<div className="flex-1 w-px bg-(--border)" />
					<span className="text-[10px] text-(--text-tertiary) py-2 rotate-90 sm:rotate-0">
						or
					</span>
					<div className="flex-1 w-px bg-(--border)" />
				</div>
				<div className="flex sm:hidden items-center gap-3 text-xs text-(--text-tertiary)">
					<div className="flex-1 h-px bg-(--border)" />
					<span>or</span>
					<div className="flex-1 h-px bg-(--border)" />
				</div>

				{/* ── RIGHT: Join + Pending games ── */}
				<div className="flex flex-col gap-3">
					<p className="text-xs font-semibold text-(--text-tertiary) uppercase tracking-widest px-1">
						Join a game
					</p>

					<input
						type="text"
						placeholder="Enter game code"
						value={gameCode}
						onChange={(e) => setGameCode(e.target.value.toUpperCase())}
						onKeyDown={(e) =>
							e.key === "Enter" && !isLoading && handleJoinGame()
						}
						maxLength={10}
						disabled={isLoading}
						className="w-full px-4 py-3 text-base border border-(--border) rounded-xl text-center uppercase outline-none focus:ring-2 focus:ring-(--accent-primary) bg-(--bg-secondary) text-(--text) placeholder:text-(--text-tertiary) transition-all tracking-widest font-mono disabled:opacity-50"
					/>
					<button
						onClick={handleJoinGame}
						disabled={!gameCode.trim() || isLoading || !isConnected}
						className="w-full px-6 py-3.5 text-base font-bold bg-(--bg-tertiary) hover:bg-(--bg-secondary) border border-(--border) disabled:opacity-40 disabled:cursor-not-allowed transition-all rounded-2xl active:scale-[0.98] flex items-center justify-center gap-2"
					>
						{step === "fetching" || step === "joining" ? (
							<>
								<Spinner size={16} />
								{step === "fetching" ? "Checking…" : "Joining…"}
							</>
						) : (
							"Join Game"
						)}
					</button>

					{/* Pending games list */}
					{isConnected && (
						<PendingGamesList onJoin={handleJoinByCode} disabled={isLoading} />
					)}
				</div>
			</div>
		</div>
	);
}
