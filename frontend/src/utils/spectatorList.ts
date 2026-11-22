import type { SpectatorPresence } from "../api/socket";

export type SpectatorSortKey = "alphabetical" | "rating" | "joined";

export function spectatorDisplayName(spectator: SpectatorPresence): string {
	return spectator.name?.trim() || spectator.address;
}

/** Earliest join first; spectators without a join time sort last. */
function compareJoinTimes(a: number | undefined, b: number | undefined): number {
	const left = a ?? Number.POSITIVE_INFINITY;
	const right = b ?? Number.POSITIVE_INFINITY;
	if (left === right) return 0;
	return left < right ? -1 : 1;
}

/**
 * Filters spectators by name or address (case-insensitive) and sorts them.
 * Missing ratings count as 0 and missing join times sort last. Returns a new array.
 */
export function filterAndSortSpectators(
	spectators: SpectatorPresence[],
	query: string,
	sortBy: SpectatorSortKey,
): SpectatorPresence[] {
	const needle = query.trim().toLowerCase();
	const matches =
		needle === ""
			? spectators.slice()
			: spectators.filter(
					(spectator) =>
						spectator.address.toLowerCase().includes(needle) ||
						(spectator.name ?? "").toLowerCase().includes(needle),
				);

	return matches.sort((a, b) => {
		if (sortBy === "rating") {
			return (b.rating ?? 0) - (a.rating ?? 0);
		}
		if (sortBy === "joined") {
			return compareJoinTimes(a.joinedAt, b.joinedAt);
		}
		return spectatorDisplayName(a).localeCompare(spectatorDisplayName(b));
	});
}
