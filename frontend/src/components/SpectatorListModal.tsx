import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import type { SpectatorPresence } from "../api/socket";
import {
	filterAndSortSpectators,
	spectatorDisplayName,
	type SpectatorSortKey,
} from "../utils/spectatorList";

const SORT_LABELS: Record<SpectatorSortKey, string> = {
	alphabetical: "Name",
	rating: "Rating",
	joined: "Joined",
};

const BADGE_LABELS: Record<NonNullable<SpectatorPresence["badge"]>, string> = {
	master: "Master",
	verified: "Verified",
	organizer: "Organizer",
};

/** Stable colour for a wallet address, used for the avatar circle. */
function avatarHue(address: string): number {
	let hash = 0;
	for (let i = 0; i < address.length; i += 1) {
		hash = (hash * 31 + address.charCodeAt(i)) >>> 0;
	}
	return hash % 360;
}

export interface SpectatorListModalProps {
	spectators: SpectatorPresence[];
	onClose?: () => void;
}

export default function SpectatorListModal({ spectators, onClose }: SpectatorListModalProps) {
	const [query, setQuery] = useState("");
	const [sortBy, setSortBy] = useState<SpectatorSortKey>("alphabetical");

	const visible = useMemo(
		() => filterAndSortSpectators(spectators, query, sortBy),
		[spectators, query, sortBy],
	);

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
			role="dialog"
			aria-modal="true"
			aria-labelledby="spectator-list-title"
		>
			<div className="w-full max-w-md max-h-[80vh] flex flex-col gap-4 rounded-2xl border border-(--border) bg-(--bg-secondary) p-5 shadow-2xl">
				<div className="flex items-center justify-between">
					<h2 id="spectator-list-title" className="text-base font-bold">
						Spectators{" "}
						<span
							data-testid="spectator-count"
							aria-live="polite"
							className="font-mono text-(--text-secondary)"
						>
							({spectators.length})
						</span>
					</h2>
					{onClose && (
						<button
							type="button"
							onClick={onClose}
							aria-label="Close spectator list"
							className="text-(--text-tertiary) hover:text-(--text) transition-colors"
						>
							<X size={18} />
						</button>
					)}
				</div>

				<div className="flex gap-2">
					<label className="relative flex-1">
						<span className="sr-only">Search spectators</span>
						<Search
							size={14}
							aria-hidden="true"
							className="absolute left-2 top-1/2 -translate-y-1/2 text-(--text-tertiary)"
						/>
						<input
							type="search"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder="Search by name or address"
							className="w-full rounded-lg border border-(--border) bg-(--bg) py-1.5 pl-7 pr-2 text-sm"
						/>
					</label>
					<select
						aria-label="Sort spectators"
						value={sortBy}
						onChange={(event) => setSortBy(event.target.value as SpectatorSortKey)}
						className="rounded-lg border border-(--border) bg-(--bg) px-2 py-1.5 text-sm"
					>
						{(Object.keys(SORT_LABELS) as SpectatorSortKey[]).map((key) => (
							<option key={key} value={key}>
								{SORT_LABELS[key]}
							</option>
						))}
					</select>
				</div>

				<ul className="flex-1 overflow-y-auto flex flex-col gap-1">
					{visible.map((spectator) => {
						const name = spectatorDisplayName(spectator);
						return (
							<li
								key={spectator.address}
								className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-(--bg-tertiary)"
							>
								<span
									aria-hidden="true"
									className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
									style={{ backgroundColor: `hsl(${avatarHue(spectator.address)} 60% 40%)` }}
								>
									{name.charAt(0).toUpperCase()}
								</span>
								<span className="min-w-0 flex-1 truncate text-sm">{name}</span>
								{spectator.badge && (
									<span className="rounded-full border border-(--accent-primary)/50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-(--accent-primary)">
										{BADGE_LABELS[spectator.badge]}
									</span>
								)}
								{typeof spectator.rating === "number" && (
									<span className="font-mono text-xs text-(--text-secondary)">
										{spectator.rating}
									</span>
								)}
							</li>
						);
					})}
					{visible.length === 0 && (
						<li className="text-sm italic text-(--text-tertiary)">
							No spectators match your search.
						</li>
					)}
				</ul>
			</div>
		</div>
	);
}
