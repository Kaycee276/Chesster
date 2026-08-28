/**
 * Deterministic stand-in for @stellar/freighter-api, used only when
 * VITE_E2E=true (see vite.config.ts). There is no real Freighter browser
 * extension available under Playwright, so this stub lets e2e specs drive
 * "wallet connection" by writing a fake address to localStorage before
 * navigating, via `page.addInitScript`.
 *
 * The fake address key is intentionally distinct per browser context so two
 * Playwright contexts (white / black) each get their own identity.
 */

const STORAGE_KEY = "__e2e_wallet_address__";

function readFakeAddress(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export async function requestAccess(): Promise<{ address?: string; error?: string }> {
  const address = readFakeAddress();
  if (!address) return { error: "No e2e wallet address configured" };
  return { address };
}

export async function isConnected(): Promise<{ isConnected: boolean }> {
  return { isConnected: !!readFakeAddress() };
}

export async function getAddress(): Promise<{ address?: string }> {
  const address = readFakeAddress();
  return address ? { address } : {};
}

export async function signTransaction(): Promise<{ signedTxXdr: string; error?: string }> {
  // Not exercised by the non-wagered e2e gameplay flow; present only to
  // satisfy the module's export surface.
  return { signedTxXdr: "" };
}

export class WatchWalletChanges {
  watch(_callback: (params: { address?: string }) => void): void {
    // No-op: the e2e stub address never changes after connect.
  }
  stop(): void {
    // No-op.
  }
}
