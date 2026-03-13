const ERROR_MAP: [string, string][] = [
  ["game not found",                    "Game not found — it may have expired."],
  ["cannot join game",                  "This game can't be joined right now."],
  ["you cannot play against yourself",  "You can't join a game you created."],
  ["player color already taken",        "That color is already taken."],
  ["game not active",                   "The game hasn't started yet."],
  ["game is not active",                "The game isn't active."],
  ["not active",                        "The game isn't active."],
  ["invalid move",                      "That's not a valid move."],
  ["promotion piece required",          "Choose a piece to promote your pawn."],
  ["no draw offer pending",             "There's no pending draw offer."],
  ["game could not be updated",         "Couldn't save the game — please try again."],
  ["failed to fetch",                   "Connection lost — check your network."],
  ["networkerror",                      "Connection error — please try again."],
  ["load failed",                       "Connection error — please try again."],
  ["user rejected",                     "Transaction cancelled."],
  ["user denied",                       "Transaction cancelled."],
  ["rejected",                          "Transaction cancelled."],
  ["insufficient funds",                "Insufficient funds in your wallet."],
  ["execution reverted",                "Transaction failed on-chain."],
  ["internal json-rpc",                 "Transaction failed on-chain."],
  ["gas required exceeds allowance",    "Transaction failed — not enough gas."],
  ["nonce too low",                     "Transaction failed — please reset your wallet nonce."]
];

/** RPC error codes emitted by MetaMask / EIP-1193 providers */
const RPC_CODE_MAP: Record<number, string> = {
  4001:  "Transaction cancelled.",       // user rejected
  4100:  "Wallet not authorised.",       // unauthorised
  4200:  "Unsupported wallet method.",   // unsupported method
  4900:  "Wallet disconnected.",
  4901:  "Wrong network selected.",
  [-32603]: "Transaction failed on-chain.", // internal JSON-RPC error
  [-32000]: "Transaction failed on-chain.", // invalid input / nonce issue
  [-32002]: "Request already pending in your wallet.", // already pending
};

/**
 * Converts a raw error (from the backend, network, or wallet) into a
 * short, human-readable message suitable for display in a toast.
 */
export function friendlyError(err: unknown, fallback = "Something went wrong."): string {
  // Handle MetaMask / EIP-1193 RPC error objects (they are plain objects, not Error instances)
  if (err !== null && typeof err === "object") {
    const rpcErr = err as Record<string, unknown>;
    const code = typeof rpcErr.code === "number" ? rpcErr.code : undefined;

    if (code !== undefined && code in RPC_CODE_MAP) {
      return RPC_CODE_MAP[code];
    }

    // Check nested data.message for a more specific on-chain reason
    const dataMsg =
      typeof (rpcErr.data as Record<string, unknown>)?.message === "string"
        ? ((rpcErr.data as Record<string, unknown>).message as string)
        : null;
    if (dataMsg) {
      const dataLower = dataMsg.toLowerCase();
      for (const [key, msg] of ERROR_MAP) {
        if (dataLower.includes(key)) return msg;
      }
    }
  }

  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : typeof (err as Record<string, unknown>)?.message === "string"
          ? ((err as Record<string, unknown>).message as string)
          : "";

  const lower = raw.toLowerCase();

  for (const [key, msg] of ERROR_MAP) {
    if (lower.includes(key)) return msg;
  }

  // If the raw message is short and looks human-readable, use it directly
  if (raw && raw.length < 80 && !lower.includes(" at ") && !lower.startsWith("error:")) {
    return raw;
  }

  return fallback;
}
