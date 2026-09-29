import { useEffect, useState, useRef } from "react";
import { useWalletStore } from "../store/walletStore";
import { useToastStore } from "../store/toastStore";
import { referralApi, type ReferralStats } from "../api/referralApi";
import WalletDropdown from "../components/WalletDropdown";
import {
	Copy,
	QrCode,
	Users,
	TrendingUp,
	Gift,
} from "lucide-react";

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

interface StatCardProps {
	icon: React.ReactNode;
	label: string;
	value: string;
	sublabel?: string;
}

function StatCard({ icon, label, value, sublabel }: StatCardProps) {
	return (
		<div className="bg-(--bg-secondary) border border-(--border) rounded-xl p-4 flex flex-col gap-2">
			<div className="flex items-center gap-2">
				<div className="w-6 h-6 flex items-center justify-center text-(--text-secondary)">
					{icon}
				</div>
				<p className="text-xs font-semibold uppercase tracking-widest text-(--text-tertiary)">
					{label}
				</p>
			</div>
			<p className="text-2xl font-bold">{value}</p>
			{sublabel && <p className="text-xs text-(--text-tertiary)">{sublabel}</p>}
		</div>
	);
}

interface QRModalProps {
	isOpen: boolean;
	onClose: () => void;
	referralLink: string;
}

function QRModal({ isOpen, onClose, referralLink }: QRModalProps) {
	if (!isOpen) return null;

	// Simple QR code renderer using a placeholder canvas
	// In production, this would use a real QR library like qrcode.react
	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
			onClick={onClose}
		>
			<div
				className="w-full max-w-sm mx-4 bg-(--bg-secondary) border border-(--border) rounded-2xl p-6 flex flex-col gap-4 shadow-2xl"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex flex-col gap-1">
					<h3 className="text-lg font-bold">Share Your Referral Code</h3>
					<p className="text-sm text-(--text-secondary)">
						Scan this QR code to share your referral link
					</p>
				</div>

				{/* QR Code placeholder - would be replaced with actual QR code library */}
				<div className="bg-(--bg) border-2 border-dashed border-(--border) rounded-lg p-8 flex items-center justify-center">
					<div className="text-center">
						<QrCode size={64} className="mx-auto mb-3 text-(--text-tertiary)" />
						<p className="text-xs text-(--text-tertiary) mb-2">QR Code</p>
						<p className="text-xs font-mono bg-(--bg-tertiary) p-2 rounded break-all">
							{referralLink}
						</p>
					</div>
				</div>

				<button
					onClick={onClose}
					className="w-full px-4 py-2 rounded-lg bg-(--accent-dark) hover:bg-(--accent-primary) text-white font-semibold transition-colors"
				>
					Close
				</button>
			</div>
		</div>
	);
}

interface ReferredUsersTableProps {
	users: Array<{
		address: string;
		signup_date: string;
		matches_played: number;
	}>;
	loading: boolean;
}

function ReferredUsersTable({ users, loading }: ReferredUsersTableProps) {
	if (loading) {
		return (
			<div className="bg-(--bg-secondary) border border-(--border) rounded-lg p-6 flex items-center justify-center">
				<Spinner size={20} />
			</div>
		);
	}

	if (users.length === 0) {
		return (
			<div className="bg-(--bg-secondary) border border-(--border) rounded-lg p-6 text-center">
				<Users size={32} className="mx-auto mb-2 text-(--text-tertiary)" />
				<p className="text-sm text-(--text-secondary)">No referred users yet</p>
			</div>
		);
	}

	return (
		<div className="bg-(--bg-secondary) border border-(--border) rounded-lg overflow-hidden">
			<div className="overflow-x-auto">
				<table className="w-full text-sm">
					<thead className="bg-(--bg-tertiary) border-b border-(--border)">
						<tr>
							<th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-widest text-(--text-tertiary)">
								Player
							</th>
							<th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-widest text-(--text-tertiary)">
								Joined
							</th>
							<th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-widest text-(--text-tertiary)">
								Matches
							</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-border">
						{users.map((user, idx) => (
							<tr
								key={idx}
								className="hover:bg-(--bg-tertiary) transition-colors"
							>
								<td className="px-4 py-3 font-mono text-xs">
									{/* Anonymize: show first 4 + last 4 chars */}
									{user.address.slice(0, 4)}...{user.address.slice(-4)}
								</td>
								<td className="px-4 py-3 text-xs text-(--text-secondary)">
									{new Date(user.signup_date).toLocaleDateString()}
								</td>
								<td className="px-4 py-3 text-right text-xs font-semibold">
									{user.matches_played}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

interface ClaimConfirmModalProps {
	isOpen: boolean;
	amount: number;
	currency: "XLM" | "USDC";
	onConfirm: () => void;
	onCancel: () => void;
	loading: boolean;
}

function ClaimConfirmModal({
	isOpen,
	amount,
	currency,
	onConfirm,
	onCancel,
	loading,
}: ClaimConfirmModalProps) {
	if (!isOpen) return null;

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
			onClick={onCancel}
		>
			<div
				className="w-full max-w-xs mx-4 bg-(--bg-secondary) border border-(--border) rounded-2xl p-6 flex flex-col gap-4 shadow-2xl"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex flex-col gap-1">
					<h3 className="text-lg font-bold">Claim Rewards</h3>
					<p className="text-sm text-(--text-secondary)">
						Claim {amount} {currency} to your wallet?
					</p>
				</div>

				<div className="bg-(--bg-tertiary) rounded-lg p-4 text-center">
					<p className="text-xs text-(--text-tertiary) mb-1">Amount</p>
					<p className="text-2xl font-bold">
						{amount} <span className="text-sm">{currency}</span>
					</p>
				</div>

				<div className="flex gap-2 justify-end">
					<button
						onClick={onCancel}
						disabled={loading}
						className="px-4 py-2 rounded-lg text-sm font-semibold bg-(--bg-tertiary) hover:bg-(--border) text-(--text-secondary) hover:text-(--text) transition-colors disabled:opacity-50"
					>
						Cancel
					</button>
					<button
						onClick={onConfirm}
						disabled={loading}
						className="px-4 py-2 rounded-lg text-sm font-semibold bg-green-600 hover:bg-green-700 text-white transition-colors disabled:opacity-50 flex items-center gap-2"
					>
						{loading ? <Spinner size={14} /> : null}
						{loading ? "Claiming…" : "Claim"}
					</button>
				</div>
			</div>
		</div>
	);
}

export default function ReferralPage() {
	const { address, isConnected } = useWalletStore();
	const { addToast } = useToastStore();

	const [stats, setStats] = useState<ReferralStats | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [qrModalOpen, setQrModalOpen] = useState(false);
	const [claimModalOpen, setClaimModalOpen] = useState(false);
	const [claimedCurrency, setClaimedCurrency] = useState<"XLM" | "USDC">("XLM");
	const [claiming, setClaiming] = useState(false);
	const copyRef = useRef<HTMLInputElement>(null);

	// Fetch referral stats on mount
	useEffect(() => {
		if (!address) return;

		const fetchStats = async () => {
			setLoading(true);
			setError(null);
			try {
				const res = await referralApi.getReferralStats(address);
				if (res.success && res.data) {
					setStats(res.data);
				} else {
					setError(res.error || "Failed to fetch referral stats");
				}
			} catch (err) {
				setError(
					err instanceof Error ? err.message : "Failed to fetch referral stats"
				);
			} finally {
				setLoading(false);
			}
		};

		fetchStats();
	}, [address]);

	const referralLink = stats
		? `${window.location.origin}/join?ref=${stats.referral_code}`
		: "";

	const handleCopyLink = async () => {
		try {
			if (copyRef.current) {
				copyRef.current.select();
				document.execCommand("copy");
				addToast("Referral link copied to clipboard!", "success");
			}
		} catch (err) {
			addToast("Failed to copy link", "error");
		}
	};

	const handleClaimEarnings = async (currency: "XLM" | "USDC") => {
		setClaimedCurrency(currency);
		setClaimModalOpen(true);
	};

	const confirmClaim = async () => {
		if (!address || !stats) return;

		setClaiming(true);
		try {
			// In a real implementation, this would:
			// 1. Get a signing payload from the backend
			// 2. Use the wallet to sign the payload
			// 3. Submit the signed payload to claimReferralEarnings
			// For now, we'll mock this flow
			const mockSignedPayload = `mock_signature_${Date.now()}`;
			const amount =
				claimedCurrency === "XLM"
					? stats.claimable_xlm
					: stats.claimable_usdc;

			const res = await referralApi.claimReferralEarnings({
				signed_payload: mockSignedPayload,
				wallet_address: address,
			});

			if (res.success) {
				addToast(
					`Successfully claimed ${amount} ${claimedCurrency}!`,
					"success"
				);
				setClaimModalOpen(false);
				// Refresh stats
				const statsRes = await referralApi.getReferralStats(address);
				if (statsRes.success && statsRes.data) {
					setStats(statsRes.data);
				}
			} else {
				addToast(res.error || "Failed to claim earnings", "error");
			}
		} catch (err) {
			addToast(
				err instanceof Error ? err.message : "Failed to claim earnings",
				"error"
			);
		} finally {
			setClaiming(false);
		}
	};

	// Not connected
	if (!isConnected || !address) {
		return (
			<div className="flex flex-col items-center justify-center h-svh overflow-hidden gap-6 bg-(--bg) p-4">
				<div className="absolute top-4 right-4">
					<WalletDropdown />
				</div>
				<div className="w-full max-w-sm flex flex-col gap-5 items-center">
					<Gift size={48} className="text-(--text-tertiary)" />
					<div className="text-center flex flex-col gap-1">
						<h2 className="text-2xl font-bold">Referral Dashboard</h2>
						<p className="text-sm text-(--text-secondary)">
							Connect your wallet to view your referral stats
						</p>
					</div>
				</div>
			</div>
		);
	}

	// Loading
	if (loading) {
		return (
			<div className="flex flex-col items-center justify-center h-svh overflow-hidden gap-4 bg-(--bg)">
				<Spinner size={28} />
				<p className="text-sm text-(--text-secondary)">Loading referral data…</p>
			</div>
		);
	}

	// Error
	if (error) {
		return (
			<div className="flex flex-col items-center justify-center h-svh overflow-hidden gap-4 bg-(--bg) p-4">
				<div className="absolute top-4 right-4">
					<WalletDropdown />
				</div>
				<div className="w-full max-w-sm flex flex-col gap-4 items-center">
					<div className="text-center flex flex-col gap-2">
						<h2 className="text-xl font-bold text-red-400">Error</h2>
						<p className="text-sm text-(--text-secondary)">{error}</p>
					</div>
					<button
						onClick={() => window.location.reload()}
						className="px-4 py-2 rounded-lg bg-(--accent-dark) hover:bg-(--accent-primary) text-white font-semibold transition-colors"
					>
						Retry
					</button>
				</div>
			</div>
		);
	}

	// Main page
	return (
		<div className="flex flex-col items-center justify-start min-h-svh overflow-auto gap-6 bg-(--bg) p-4 py-8">
			<div className="absolute top-4 right-4">
				<WalletDropdown />
			</div>

			<div className="w-full max-w-2xl flex flex-col gap-8">
				{/* Header */}
				<div className="text-center flex flex-col gap-2">
					<p className="text-xs font-semibold uppercase tracking-widest text-(--text-tertiary)">
						Earn
					</p>
					<h1 className="text-4xl font-bold font-mono tracking-widest">
						Referral Dashboard
					</h1>
					<p className="text-sm text-(--text-secondary)">
						Invite friends and earn commission on their gameplay
					</p>
				</div>

				{/* Stats Grid */}
				<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
					<StatCard
						icon={<Users size={18} />}
						label="Friends Invited"
						value={String(stats?.total_invited ?? 0)}
					/>
					<StatCard
						icon={<TrendingUp size={18} />}
						label="Wager Volume"
						value={`${(stats?.total_wager_volume ?? 0).toFixed(2)} XLM`}
					/>
					<StatCard
						icon={<Gift size={18} />}
						label="Total Earnings"
						value={`${(stats?.total_commission_earned ?? 0).toFixed(6)} XLM`}
					/>
				</div>

				{/* Referral Link Section */}
				<div className="bg-(--bg-secondary) border border-(--border) rounded-2xl p-6 flex flex-col gap-4">
					<div className="flex flex-col gap-1">
						<h2 className="text-lg font-bold">Your Referral Link</h2>
						<p className="text-sm text-(--text-secondary)">
							Share this link to invite your friends
						</p>
					</div>

					<div className="flex gap-2">
						<input
							ref={copyRef}
							type="text"
							value={referralLink}
							readOnly
							className="flex-1 px-4 py-2 rounded-lg bg-(--bg) border border-(--border) text-sm font-mono text-(--text) focus:outline-none"
						/>
						<button
							onClick={handleCopyLink}
							className="px-4 py-2 rounded-lg bg-(--accent-dark) hover:bg-(--accent-primary) text-white font-semibold transition-colors flex items-center gap-2"
						>
							<Copy size={16} />
							Copy
						</button>
					</div>

					<button
						onClick={() => setQrModalOpen(true)}
						className="w-full px-4 py-2 rounded-lg bg-(--bg-tertiary) hover:bg-(--border) text-(--text) font-semibold transition-colors flex items-center justify-center gap-2"
					>
						<QrCode size={16} />
						Show QR Code
					</button>
				</div>

				{/* Claimable Earnings */}
				{(stats?.claimable_xlm ?? 0) > 0 || (stats?.claimable_usdc ?? 0) > 0 ? (
					<div className="bg-green-500/10 border border-green-500/30 rounded-2xl p-6 flex flex-col gap-4">
						<div className="flex flex-col gap-1">
							<h2 className="text-lg font-bold">Claim Your Rewards</h2>
							<p className="text-sm text-green-400/80">
								You have earnings ready to claim
							</p>
						</div>

						<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
							{(stats?.claimable_xlm ?? 0) > 0 && (
								<button
									onClick={() => handleClaimEarnings("XLM")}
									className="px-4 py-3 rounded-lg bg-green-600 hover:bg-green-700 text-white font-semibold transition-colors flex flex-col items-center gap-1"
								>
									<span className="text-xs opacity-80">Claim XLM</span>
									<span className="text-lg font-bold">
										{stats?.claimable_xlm?.toFixed(6)} XLM
									</span>
								</button>
							)}
							{(stats?.claimable_usdc ?? 0) > 0 && (
								<button
									onClick={() => handleClaimEarnings("USDC")}
									className="px-4 py-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold transition-colors flex flex-col items-center gap-1"
								>
									<span className="text-xs opacity-80">Claim USDC</span>
									<span className="text-lg font-bold">
										{stats?.claimable_usdc?.toFixed(6)} USDC
									</span>
								</button>
							)}
						</div>
					</div>
				) : (
					<div className="bg-(--bg-secondary) border border-(--border) rounded-2xl p-6 text-center">
						<p className="text-sm text-(--text-secondary)">
							No rewards to claim yet. Earn commissions by inviting friends!
						</p>
					</div>
				)}

				{/* Referred Users Table */}
				<div className="flex flex-col gap-3">
					<div className="flex flex-col gap-1">
						<h2 className="text-lg font-bold">Your Referrals</h2>
						<p className="text-sm text-(--text-secondary)">
							Players who signed up using your link
						</p>
					</div>
					<ReferredUsersTable
						users={stats?.referred_users ?? []}
						loading={false}
					/>
				</div>

				{/* Modals */}
				<QRModal
					isOpen={qrModalOpen}
					onClose={() => setQrModalOpen(false)}
					referralLink={referralLink}
				/>
				<ClaimConfirmModal
					isOpen={claimModalOpen}
					amount={
						claimedCurrency === "XLM"
							? stats?.claimable_xlm ?? 0
							: stats?.claimable_usdc ?? 0
					}
					currency={claimedCurrency}
					onConfirm={confirmClaim}
					onCancel={() => setClaimModalOpen(false)}
					loading={claiming}
				/>
			</div>
		</div>
	);
}
