/**
 * Truncate a wallet address or string to a displayable form.
 * Returns the first N and last N characters separated by "...".
 * If the string is shorter than N*2, returns unchanged.
 * Handles null/undefined safely.
 *
 * @param address - The wallet address or identifier to truncate
 * @param chars - Number of characters to show at start and end (default: 4)
 * @returns Truncated form (e.g., "GABC...WXYZ") or unchanged if too short
 */
export function truncateWallet(
  address: string | null | undefined,
  chars: number = 4,
): string {
  if (!address || typeof address !== "string") {
    return "";
  }

  const len = address.length;
  const minLen = chars * 2;

  if (len <= minLen) {
    return address;
  }

  const start = address.slice(0, chars);
  const end = address.slice(-chars);
  return `${start}...${end}`;
}
