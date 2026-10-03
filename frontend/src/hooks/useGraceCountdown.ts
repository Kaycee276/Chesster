import { useEffect, useState } from "react";

/**
 * useGraceCountdown (#317)
 *
 * Counts `seconds` down to 0, one tick per second. Used by GamePage to drive
 * DisconnectBanner while the opponent's reconnect grace timer runs.
 */
export function useGraceCountdown(seconds: number): number {
	const [remaining, setRemaining] = useState(seconds);
	// Restart the countdown when a new grace period arrives from the server.
	useEffect(() => {
		setRemaining(seconds); // eslint-disable-line react-hooks/set-state-in-effect
	}, [seconds]);
	useEffect(() => {
		if (remaining <= 0) return;
		const id = setTimeout(
			() => setRemaining((s) => Math.max(0, s - 1)),
			1000,
		);
		return () => clearTimeout(id);
	}, [remaining]);
	return remaining;
}
