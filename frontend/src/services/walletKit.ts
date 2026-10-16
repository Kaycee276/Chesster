import { Networks } from "@stellar/stellar-sdk";

export const NETWORK_PASSPHRASE =
	import.meta.env.VITE_STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;

type WalletKit = typeof import("@creit.tech/stellar-wallets-kit/sdk").StellarWalletsKit;
let kitPromise: Promise<WalletKit> | null = null;

export function getWalletKit(): Promise<WalletKit> {
	if (!kitPromise) {
		kitPromise = (async () => {
			const [{ StellarWalletsKit }, { defaultModules }, { LobstrModule }, { WalletConnectModule }] = await Promise.all([
				import("@creit.tech/stellar-wallets-kit/sdk"),
				import("@creit.tech/stellar-wallets-kit/modules/utils"),
				import("@creit.tech/stellar-wallets-kit/modules/lobstr"),
				import("@creit.tech/stellar-wallets-kit/modules/wallet-connect"),
			]);
			const modules = [...defaultModules()];
			if (!modules.some((module) => module.productId.toLowerCase().includes("lobstr"))) {
				modules.push(new LobstrModule());
			}
			const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;
			if (projectId && !modules.some((module) => module.productId.toLowerCase().includes("walletconnect"))) {
				modules.push(new WalletConnectModule({
					projectId,
					metadata: {
						name: "Chesster",
						description: "Decentralized chess on Stellar",
						url: window.location.origin,
						icons: [`${window.location.origin}/favicon.ico`],
					},
				}));
			}
			StellarWalletsKit.init({ modules });
			StellarWalletsKit.setNetwork(NETWORK_PASSPHRASE);
			return StellarWalletsKit;
		})();
	}
	return kitPromise;
}

export async function connectWithWalletKit(): Promise<{ address: string; networkPassphrase: string; walletType: string }> {
	const kit = await getWalletKit();
	const { address } = await kit.authModal();
	if (!address) throw new Error("Wallet did not return an address");
	const { networkPassphrase } = await kit.getNetwork();
	return { address, networkPassphrase, walletType: kit.selectedModule.productId };
}

export async function getWalletNetwork(): Promise<string> {
	return (await (await getWalletKit()).getNetwork()).networkPassphrase;
}

export async function disconnectWalletKit(): Promise<void> {
	await (await getWalletKit()).disconnect();
}

export async function restoreWalletKitConnection(): Promise<{
	address: string;
	networkPassphrase: string;
	walletType: string;
} | null> {
	try {
		const kit = await getWalletKit();
		const [{ address }, { networkPassphrase }] = await Promise.all([kit.getAddress(), kit.getNetwork()]);
		return address ? { address, networkPassphrase, walletType: kit.selectedModule.productId } : null;
	} catch {
		return null;
	}
}

export async function signTransactionWithWalletKit(
	xdr: string,
	address: string,
	networkPassphrase = NETWORK_PASSPHRASE,
): Promise<string> {
	const { signedTxXdr, signerAddress } = await (await getWalletKit()).signTransaction(xdr, { address, networkPassphrase });
	if (!signedTxXdr) throw new Error("Signing failed: no signed XDR returned");
	if (signerAddress && signerAddress !== address) throw new Error("Wallet signed with an unexpected address");
	return signedTxXdr;
}

export async function signAuthEntryWithWalletKit(
	authEntryXdr: string,
	address: string,
	networkPassphrase = NETWORK_PASSPHRASE,
): Promise<string> {
	const { signedAuthEntry, signerAddress } = await (await getWalletKit()).signAuthEntry(authEntryXdr, { address, networkPassphrase });
	if (!signedAuthEntry) throw new Error("Signing failed: no signed auth entry returned");
	if (signerAddress && signerAddress !== address) throw new Error("Wallet signed with an unexpected address");
	return signedAuthEntry;
}

export async function signMessageWithWalletKit(
	message: string,
	address: string,
	networkPassphrase = NETWORK_PASSPHRASE,
): Promise<string> {
	const { signedMessage, signerAddress } = await (await getWalletKit()).signMessage(message, { address, networkPassphrase });
	if (!signedMessage) throw new Error("Signing failed: no signed message returned");
	if (signerAddress && signerAddress !== address) throw new Error("Wallet signed with an unexpected address");
	return signedMessage;
}
