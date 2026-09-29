import { Networks } from "@stellar/stellar-sdk";

const NETWORK_LABELS: Record<string, string> = {
	[Networks.PUBLIC]: "Mainnet",
	[Networks.TESTNET]: "Testnet",
	[Networks.FUTURENET]: "Futurenet",
	[Networks.SANDBOX]: "Sandbox",
	[Networks.STANDALONE]: "Standalone",
};

/** Human-readable label for a Stellar network passphrase (e.g. "Testnet"). */
export function describeNetwork(passphrase: string | null | undefined): string {
	if (!passphrase) return "an unknown network";
	return NETWORK_LABELS[passphrase] ?? passphrase;
}

/**
 * True when the wallet's active network passphrase doesn't match the
 * network Chesster is configured to use.
 */
export function isNetworkMismatch(
	walletPassphrase: string | null | undefined,
	targetPassphrase: string,
): boolean {
	if (!walletPassphrase) return false;
	return walletPassphrase !== targetPassphrase;
}
