import { create } from "zustand";
import {
  isConnected,
  getAddress,
  requestAccess,
  WatchWalletChanges,
} from "@stellar/freighter-api";

export type WalletType = "freighter" | "xbull" | "albedo" | "rabet";

// Window-injected wallet globals (set by browser extensions)
declare global {
  interface Window {
    xBullSDK?: { connect(): Promise<{ publicKey: string }> };
    albedo?: { publicKey(opts?: object): Promise<{ pubkey: string }> };
    rabet?: { connect(): Promise<{ publicKey: string }> };
  }
}

interface WalletState {
  address: string | null;
  isConnected: boolean;
  walletType: WalletType | null;
  connect: () => Promise<void>;
  connectWith: (type: WalletType) => Promise<void>;
  disconnect: () => void;
  startWatching: () => void;
  stopWatching: () => void;
  checkConnection: () => Promise<void>;
}

async function connectXBull(): Promise<string> {
  if (!window.xBullSDK) throw new Error("xBull extension not found");
  const result = await window.xBullSDK.connect();
  return result.publicKey;
}

async function connectAlbedo(): Promise<string> {
  if (!window.albedo) throw new Error("Albedo extension not found");
  const result = await window.albedo.publicKey({});
  return result.pubkey;
}

async function connectRabet(): Promise<string> {
  if (!window.rabet) throw new Error("Rabet extension not found");
  const result = await window.rabet.connect();
  return result.publicKey;
}

export const useWalletStore = create<WalletState>((set) => {
  let watcher: WatchWalletChanges | null = null;

  return {
    address: null,
    isConnected: false,
    walletType: null,

    connect: async () => {
      try {
        const access = await requestAccess();
        if (access.address) {
          set({ address: access.address, isConnected: true, walletType: "freighter" });
        } else if ("error" in access && access.error) {
          console.error("Freighter access error:", access.error);
        }
      } catch (error) {
        console.error("Failed to connect Freighter:", error);
      }
    },

    connectWith: async (type: WalletType) => {
      try {
        let address: string;
        if (type === "freighter") {
          const access = await requestAccess();
          if (!access.address) throw new Error("Freighter did not return an address");
          address = access.address;
        } else if (type === "xbull") {
          address = await connectXBull();
        } else if (type === "albedo") {
          address = await connectAlbedo();
        } else {
          address = await connectRabet();
        }
        set({ address, isConnected: true, walletType: type });
      } catch (error) {
        console.error(`Failed to connect ${type}:`, error);
        throw error;
      }
    },

    disconnect: () => {
      set({ address: null, isConnected: false, walletType: null });
    },

    startWatching: () => {
      if (!watcher) {
        watcher = new WatchWalletChanges();
        watcher.watch((params: { address?: string }) => {
          if (params.address) {
            set({ address: params.address, isConnected: true, walletType: "freighter" });
          }
        });
      }
    },

    stopWatching: () => {
      if (watcher) {
        watcher.stop();
        watcher = null;
      }
    },

    checkConnection: async () => {
      try {
        const connection = await isConnected();
        if (connection.isConnected) {
          const result = await getAddress();
          if (result.address) {
            set({ address: result.address, isConnected: true, walletType: "freighter" });
          }
        }
      } catch (error) {
        console.error("Failed to check Freighter connection:", error);
      }
    },
  };
});
