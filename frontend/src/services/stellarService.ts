import { rpc, TransactionBuilder, Networks, Contract, nativeToScVal, Transaction } from "@stellar/stellar-sdk";
import { signTransaction } from "@stellar/freighter-api";

const RPC_URL = import.meta.env.VITE_STELLAR_RPC_URL || "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = import.meta.env.VITE_STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;
const ESCROW_ADDRESS = import.meta.env.VITE_ESCROW_CONTRACT_ADDRESS || import.meta.env.VITE_CONTRACT_ID || "";

const server = new rpc.Server(RPC_URL);

// Stellar account IDs (public keys) are 56-char base32 strings beginning with
// "G". Secret seeds share the same length/alphabet but begin with "S" and must
// never be requested, stored, transmitted, or logged by the frontend — signing
// is delegated entirely to the Freighter wallet extension.
const STELLAR_PUBLIC_KEY_REGEX = /^G[A-Z2-7]{55}$/;
const STELLAR_SECRET_KEY_REGEX = /^S[A-Z2-7]{55}$/;

/**
 * Defensive guard: throws if a value looks like a Stellar secret seed. Applied
 * to any externally supplied string that must only ever carry public data, so a
 * secret key accidentally passed into a client-side flow is rejected loudly
 * instead of being handled, stored, or sent over the wire.
 *
 * @param value - Untrusted string that must not contain a secret key.
 */
export function assertNoSecretKey(value: string): void {
    if (STELLAR_SECRET_KEY_REGEX.test(value)) {
        throw new Error("Secret keys must never be handled by the client");
    }
}

/**
 * Validates that a value is a well-formed Stellar public key (account ID) and
 * not a secret seed. Returns the key unchanged so call sites stay concise.
 *
 * @param publicKey - Caller-supplied wallet public key.
 * @returns The validated public key.
 */
export function assertValidPublicKey(publicKey: string): string {
    assertNoSecretKey(publicKey);
    if (!STELLAR_PUBLIC_KEY_REGEX.test(publicKey)) {
        throw new Error("Invalid Stellar public key");
    }
    return publicKey;
}

export async function depositXLM(fnName: "create_match" | "join_match", gameCode: string, amount: string, publicKey: string) {
    // Validate untrusted input first: only a public key may ever reach this
    // flow. Reject secret seeds and malformed keys before any configuration
    // lookup, network call, or transaction construction.
    assertValidPublicKey(publicKey);

    if (!ESCROW_ADDRESS) throw new Error("Escrow contract address not configured");

    const account = await server.getAccount(publicKey);
    const contract = new Contract(ESCROW_ADDRESS);

    // Convert amount to stroops (1 XLM = 10,000,000 stroops)
    const amountStroops = BigInt(Math.round(parseFloat(amount) * 10_000_000)).toString();

    // The native token address on testnet
    const nativeTokenAddress = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

    const tx = new TransactionBuilder(account, {
        fee: "10000",
        networkPassphrase: NETWORK_PASSPHRASE,
    })
    .addOperation(
        contract.call(
            fnName,
            nativeToScVal(gameCode, { type: "string" }),
            nativeToScVal(publicKey, { type: "address" }),
            ...(fnName === "create_match" ? [nativeToScVal(nativeTokenAddress, { type: "address" })] : []),
            nativeToScVal(amountStroops, { type: "i128" })
        )
    )
    .setTimeout(30)
    .build();

    const preparedTx = await server.prepareTransaction(tx);
    const signedResponse = await signTransaction(preparedTx.toXDR(), {
        networkPassphrase: NETWORK_PASSPHRASE,
    });

    if ("error" in signedResponse && signedResponse.error) {
        throw new Error(String(signedResponse.error));
    }

    const xdr = "signedTxXdr" in signedResponse ? signedResponse.signedTxXdr : "";
    if (!xdr) throw new Error("Signing failed: no signed XDR returned");

    const sendResponse = await server.sendTransaction(
        TransactionBuilder.fromXDR(xdr, NETWORK_PASSPHRASE) as unknown as Transaction
    );

    if (sendResponse.status === "PENDING") {
        let txResponse = await server.getTransaction(sendResponse.hash);
        while (txResponse.status === "NOT_FOUND") {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            txResponse = await server.getTransaction(sendResponse.hash);
        }
        if (txResponse.status !== "SUCCESS") {
            throw new Error(`Transaction failed: ${JSON.stringify(txResponse)}`);
        }
    } else {
        throw new Error(`Transaction failed: ${JSON.stringify(sendResponse)}`);
    }
}
