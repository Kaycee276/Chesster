import { rpc, TransactionBuilder, Networks, Contract, nativeToScVal, Transaction } from "@stellar/stellar-sdk";
import { signTransactionWithWalletKit } from "./walletKit";
import { useToastStore } from "../store/toastStore";

const RPC_URL = import.meta.env.VITE_STELLAR_RPC_URL || "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = import.meta.env.VITE_STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;
const ESCROW_ADDRESS = import.meta.env.VITE_ESCROW_CONTRACT_ADDRESS || import.meta.env.VITE_CONTRACT_ID || "";
const HORIZON_URL = import.meta.env.VITE_STELLAR_HORIZON_URL || "https://horizon-testnet.stellar.org";

const server = new rpc.Server(RPC_URL);

/**
 * Represents a mapped wallet error with a user-friendly category and message.
 */
export interface MappedWalletError {
  category: "user_rejection" | "insufficient_balance" | "timeout" | "wallet_issue" | "network_error" | "unknown";
  message: string;
}

/**
 * Maps unknown wallet/transaction errors to user-friendly categories and messages.
 * Handles errors from Freighter, Stellar SDK, RPC, and other sources.
 *
 * @param error - The caught error (Error, object, string, or any value)
 * @returns Mapped error with category and safe user-facing message
 *
 * The mapper:
 * - Prioritizes structured error codes and fields (e.g. error.code, error.message)
 * - Falls back to case-insensitive message substring matching
 * - Never leaks raw internals (XDR, stack traces, RPC payloads, addresses)
 * - Always returns a non-empty message; never silent failures
 * - Logs full details to console for debugging
 */
export function mapWalletError(error: unknown): MappedWalletError {
  // Log full error for debugging (not shown to user)
  console.error("[Wallet Error]", error);

  // Normalize the error to an object with message and code properties
  let errorMessage = "";
  let errorCode = "";
  let errorObj: Record<string, unknown> | null = null;

  if (error instanceof Error) {
    errorMessage = error.message;
    errorCode = (error as Record<string, unknown>).code as string || "";
    errorObj = error as Record<string, unknown>;
  } else if (typeof error === "object" && error !== null) {
    errorObj = error as Record<string, unknown>;
    errorMessage = String(errorObj.message || errorObj.msg || errorObj.detail || "");
    errorCode = String(errorObj.code || errorObj.error_code || "");
  } else if (typeof error === "string") {
    errorMessage = error;
  } else {
    errorMessage = String(error || "Unknown error");
  }

  const msgLower = errorMessage.toLowerCase();
  const codeLower = errorCode.toLowerCase();

  // ── User rejection / cancellation ────────────────────────────────────────
  // User deliberately cancelled in Freighter or wallet, not an actual failure.
  if (
    msgLower.includes("rejected") ||
    msgLower.includes("denied") ||
    msgLower.includes("user denied") ||
    msgLower.includes("user rejected") ||
    msgLower.includes("cancelled") ||
    msgLower.includes("cancelled by user") ||
    codeLower.includes("reject") ||
    codeLower.includes("cancel")
  ) {
    return {
      category: "user_rejection",
      message: "Transaction cancelled. Please try again if you'd like to proceed.",
    };
  }

  // ── Insufficient balance ─────────────────────────────────────────────────
  // User doesn't have enough XLM for fees or token balance for the wager.
  if (
    msgLower.includes("insufficient") ||
    msgLower.includes("insufficient balance") ||
    msgLower.includes("insufficient_balance") ||
    msgLower.includes("no_trust") ||
    msgLower.includes("op_no_trust") ||
    msgLower.includes("insufficient fee") ||
    msgLower.includes("tx_insufficient_balance") ||
    msgLower.includes("underfunded") ||
    codeLower.includes("insufficient") ||
    codeLower.includes("no_trust")
  ) {
    return {
      category: "insufficient_balance",
      message:
        "Insufficient balance. Ensure you have enough XLM to cover the wager amount and network fees.",
    };
  }

  // ── Timeout / Network / RPC errors ──────────────────────────────────────
  if (
    msgLower.includes("timeout") ||
    msgLower.includes("timed out") ||
    msgLower.includes("try_again_later") ||
    msgLower.includes("504") ||
    msgLower.includes("503") ||
    msgLower.includes("unable to reach") ||
    msgLower.includes("network") ||
    msgLower.includes("econnrefused") ||
    msgLower.includes("enotfound") ||
    codeLower.includes("timeout") ||
    codeLower.includes("try_again_later") ||
    codeLower.includes("network")
  ) {
    return {
      category: "timeout",
      message:
        "Network timeout. Please check your connection and try again. If the issue persists, the transaction may have succeeded — check your game status.",
    };
  }

  // ── Wallet not installed or locked ───────────────────────────────────────
  if (
    msgLower.includes("not installed") ||
    msgLower.includes("not found") ||
    msgLower.includes("wallet not detected") ||
    msgLower.includes("no such module") ||
    msgLower.includes("locked") ||
    msgLower.includes("wallet locked") ||
    msgLower.includes("not connected") ||
    msgLower.includes("not enabled") ||
    codeLower.includes("wallet_not_found") ||
    codeLower.includes("locked")
  ) {
    return {
      category: "wallet_issue",
      message: "Wallet issue: please ensure Freighter is installed, unlocked, and connected.",
    };
  }

  // ── Sequence number / transaction validation errors ──────────────────────
  // These are less common but indicate transaction structure problems
  if (
    msgLower.includes("bad_seq") ||
    msgLower.includes("txbad_seq") ||
    msgLower.includes("sequence") ||
    msgLower.includes("invalid xdr") ||
    msgLower.includes("xdr") ||
    codeLower.includes("bad_seq")
  ) {
    return {
      category: "network_error",
      message: "Transaction validation failed. Please try again.",
    };
  }

  // ── Generic network/RPC errors ──────────────────────────────────────────
  if (
    errorObj?.status === 400 ||
    errorObj?.status === 403 ||
    errorObj?.status === 404 ||
    errorObj?.status === 500 ||
    errorObj?.status === 503
  ) {
    return {
      category: "network_error",
      message:
        "Server error. Please check your network connection and try again.",
    };
  }

  // ── Unknown error: provide a safe fallback ───────────────────────────────
  // Never silently fail — always show the user something, but never leak details.
  return {
    category: "unknown",
    message:
      "Transaction failed. Please try again or contact support if the problem persists.",
  };
}


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

export interface WalletBalance {
    /** "XLM" for the native asset, otherwise the SAC's asset code. */
    assetCode: string;
    /** Human-readable balance, as returned by Horizon (e.g. "12.4550000"). */
    balance: string;
    /** Issuer account of the asset, absent for the native XLM balance. */
    assetIssuer?: string;
}

/**
 * Fetches the XLM and SAC token balances for a Stellar public key via Horizon.
 * Returns a zero XLM balance for accounts that haven't been funded/created yet,
 * since that's a normal state for a freshly-generated wallet rather than an error.
 */
export async function fetchAccountBalances(publicKey: string): Promise<WalletBalance[]> {
    if (!publicKey) throw new Error("A public key is required to fetch balances");

    let response: Response;
    try {
        response = await fetch(`${HORIZON_URL}/accounts/${publicKey}`);
    } catch {
        throw new Error("Unable to reach the Stellar network to fetch balances");
    }

    if (response.status === 404) {
        return [{ assetCode: "XLM", balance: "0" }];
    }

    if (!response.ok) {
        throw new Error(`Failed to fetch account balances (status ${response.status})`);
    }

    const data = await response.json();
    const rawBalances = Array.isArray(data?.balances) ? data.balances : [];

    return rawBalances.map(
        (b: { asset_type: string; asset_code?: string; asset_issuer?: string; balance: string }) => ({
            assetCode: b.asset_type === "native" ? "XLM" : b.asset_code || "SAC",
            balance: b.balance,
            assetIssuer: b.asset_type === "native" ? undefined : b.asset_issuer,
        }),
    );
}

export async function depositXLM(fnName: "create_match" | "join_match", gameCode: string, amount: string, publicKey: string) {
    // Validate untrusted input first: only a public key may ever reach this
    // flow. Reject secret seeds and malformed keys before any configuration
    // lookup, network call, or transaction construction.
    assertValidPublicKey(publicKey);

    if (!ESCROW_ADDRESS) throw new Error("Escrow contract address not configured");

    try {
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
        const xdr = await signTransactionWithWalletKit(preparedTx.toXDR(), publicKey, NETWORK_PASSPHRASE);

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
    } catch (error: unknown) {
        // Map error and dispatch toast
        const mappedError = mapWalletError(error);
        const { addToast } = useToastStore.getState();
        
        // Use 'warning' variant for user rejection (info), 'error' for others
        const toastType = mappedError.category === "user_rejection" ? "info" : "error";
        addToast(mappedError.message, toastType);

        // Re-throw so caller can reset UI state
        throw error;
    }
}
