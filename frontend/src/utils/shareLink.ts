/**
 * Builds the shareable link a friend can open (or scan via QR code) to jump
 * straight into a match's lobby/game route.
 *
 * Kept separate from the QR rendering so it stays trivial to unit test.
 */
export function buildShareLink(gameCode: string, origin: string = window.location.origin): string {
	const trimmed = gameCode?.trim();
	if (!trimmed) {
		throw new Error("A game code is required to build a share link");
	}
	return `${origin.replace(/\/+$/, "")}/${trimmed.toUpperCase()}`;
}
