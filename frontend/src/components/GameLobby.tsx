import { useState } from "react";
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

const ESCROW_ADDRESS = import.meta.env.VITE_ESCROW_CONTRACT_ADDRESS || "";
const BACKEND_URL =
	import.meta.env.VITE_BACKEND_URL || "http://localhost:3000/";

// Minimal ABI for the ETH escrow — players call these directly
const ESCROW_ETH_ABI = [
	"function createMatch(bytes32 gameCode) external payable",
	"function joinMatch(bytes32 gameCode) external payable",
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
			title: "Creating game…",
			sub: wagerEnabled ? "Setting up the game on the server" : undefined,
		},
		depositing: {
			title: "Confirm in wallet…",
			sub: "Send ETH to the escrow contract",
		},
		fetching: { title: "Checking game…" },
		joining: {
			title: wagerEnabled ? "Joining game on-chain…" : "Joining game…",
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
				{/* Step indicator for wager deposit + join flow */}
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
								<span className="text-green-500">✓</span>
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

// ── Wager confirm panel (shown before joining a wagered game) ─────────────────
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
					<div className="text-3xl mb-1">⚠️</div>
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
					<p>• Winner takes 95% of the pot</p>
					<p>• 5% platform fee on wins</p>
					<p>• Draws refund both players in full</p>
					<p>• Your wallet will ask to confirm the ETH transfer</p>
				</div>

				<button
					onClick={onConfirm}
					disabled={isDepositing}
					className="w-full py-3 font-bold bg-(--accent-dark) hover:bg-(--accent-primary) disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-all flex items-center justify-center gap-2"
				>
					{isDepositing ? (
						<>
							<Spinner size={16} />
							Depositing…
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

// ── Main component ────────────────────────────────────────────────────────────
export default function GameLobby() {
	const [gameCode, setGameCode] = useState("");
	const [wagerEnabled, setWagerEnabled] = useState(false);
	const [wagerAmount, setWagerAmount] = useState("");
	const [step, setStep] = useState<Step>("idle");
	const [pendingWager, setPendingWager] = useState<WagerInfo | null>(null);

	const { createGame, joinGame } = useGameStore();
	const { addToast } = useToastStore();
	const navigate = useNavigate();
	const { address, isConnected } = useAppKitAccount();
	const { walletProvider } = useAppKitProvider("eip155");

	const isLoading = step !== "idle";

	// ── Deposit ETH to escrow contract ────────────────────────────────────────
	const depositETH = async (fnName: "createMatch" | "joinMatch", code: string, amount: string) => {
		if (!walletProvider) throw new Error("Wallet not connected");
		if (!ESCROW_ADDRESS) throw new Error("Escrow contract address not configured (set VITE_ESCROW_CONTRACT_ADDRESS)");
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const provider = new ethers.BrowserProvider(walletProvider as any);
		const signer = await provider.getSigner();
		const contract = new ethers.Contract(ESCROW_ADDRESS, ESCROW_ETH_ABI, signer);
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

			// Step 1 — create game record on backend (gets us the game code)
			setStep("creating");
			let createdGameCode: string;
			try {
				const data = await api.createGame("chess", address, wagerAmount);
				if (!data.success) throw new Error(data.error || "Failed to create game");
				createdGameCode = data.data.game_code;
			} catch (err: unknown) {
				setStep("idle");
				const msg = err instanceof Error ? err.message : "Failed to create game";
				addToast(msg, "error");
				return;
			}

			// Step 2 — deposit ETH directly to escrow contract
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

			// Step 3 — register as white player in the store (socket connection etc.)
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
			// Non-wagered — simple path
			setStep("creating");
			try {
				await createGame(address);
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

	// ── Join game ─────────────────────────────────────────────────────────────
	const handleJoinGame = async () => {
		if (!isConnected || !address) {
			addToast("Please connect your wallet first", "error");
			return;
		}
		if (!gameCode.trim()) return;

		// Fetch game to check for wager
		setStep("fetching");
		let wagerInfo: { wager_amount?: number | null } = {};
		try {
			const res = await fetch(`${BACKEND_URL}api/games/${gameCode}`);
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
			// Show the wager confirmation panel
			setPendingWager({ wagerAmount: wagerInfo.wager_amount.toString() });
			setStep("join-confirming");
			return;
		}

		// Non-wagered game — join directly
		setStep("joining");
		try {
			await joinGame(gameCode, "black", address);
			navigate(`/${gameCode}`);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : "Something went wrong";
			addToast(msg, "error");
		} finally {
			setStep("idle");
		}
	};

	// ── Deposit ETH & join (after wager confirmation) ─────────────────────────
	const handleDepositAndJoin = async () => {
		if (!pendingWager || !address) return;

		// Step 1 — deposit ETH to contract
		setStep("depositing");
		try {
			await depositETH("joinMatch", gameCode, pendingWager.wagerAmount);
		} catch (err: unknown) {
			setStep("join-confirming"); // back to confirm panel
			const msg = err instanceof Error ? err.message : "ETH deposit failed";
			addToast(
				msg.includes("rejected") || msg.includes("denied")
					? "Deposit cancelled"
					: msg,
				"error",
			);
			return;
		}

		// Step 2 — join game in backend
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

	// ── Show skeleton while wallet state initializes ──────────────────────────
	if (step === "fetching" && !isLoading) {
		return <LobbySkeleton />;
	}

	// ── Main lobby ────────────────────────────────────────────────────────────
	return (
		<div className="h-svh w-screen overflow-hidden flex flex-col items-center justify-center bg-(--bg) p-4 gap-6 relative">
			{/* Loading overlay */}
			{isLoading && step !== "join-confirming" && (
				<LoadingOverlay
					step={step}
					wagerEnabled={wagerEnabled || !!pendingWager}
				/>
			)}

			{/* Wallet button */}
			<div className="absolute top-4 right-4">
				<AppKitButton />
			</div>

			{/* Logo */}
			<div className="flex flex-col items-center gap-2 text-center">
				<h1 className="text-6xl font-bold tracking-tight">Chesster</h1>
				<p className="text-(--text-secondary) text-sm">
					{isConnected
						? "Ready to play — create or join a game"
						: "Connect your wallet to play on-chain chess"}
				</p>
			</div>

			{/* Actions */}
			<div className="flex flex-col gap-3 w-full max-w-xs">
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

				{/* Wager settings (revealed when toggle is on) */}
				{wagerEnabled && isConnected && (
					<div className="flex flex-col gap-2 p-3 bg-(--bg-secondary) border border-(--border) rounded-xl">
						<p className="text-xs font-semibold text-(--text-tertiary) uppercase tracking-wider">
							Wager settings
						</p>

						{/* Amount */}
						<div className="relative">
							<input
								type="number"
								placeholder="Amount (e.g. 0.01)"
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
							Winner takes 95% · 5% platform fee · Draws refund both players
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
							Creating…
						</>
					) : step === "depositing" && wagerEnabled ? (
						<>
							<Spinner size={16} />
							Confirm in wallet…
						</>
					) : wagerEnabled ? (
						"Create Game & Wager ETH"
					) : (
						"Create New Game"
					)}
				</button>

				<div className="flex items-center gap-3 text-xs text-(--text-tertiary)">
					<div className="flex-1 h-px bg-(--border)" />
					<span>or join with a code</span>
					<div className="flex-1 h-px bg-(--border)" />
				</div>

				<input
					type="text"
					placeholder="Enter game code"
					value={gameCode}
					onChange={(e) => setGameCode(e.target.value.toUpperCase())}
					onKeyDown={(e) => e.key === "Enter" && !isLoading && handleJoinGame()}
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
			</div>
		</div>
	);
}
