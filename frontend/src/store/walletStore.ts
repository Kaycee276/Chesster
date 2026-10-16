import { create } from "zustand";
import { connectWithWalletKit, disconnectWalletKit, restoreWalletKitConnection } from "../services/walletKit";

export type WalletType = string;

interface WalletState {
  address: string | null;
  isConnected: boolean;
  walletType: WalletType | null;
  networkPassphrase: string | null;
  connect: () => Promise<void>;
  connectWith: (type: WalletType) => Promise<void>;
  disconnect: () => void;
  checkConnection: () => Promise<void>;
}

export const useWalletStore = create<WalletState>((set) => {
  return {
    address: null,
    isConnected: false,
    walletType: null,
    networkPassphrase: null,

    connect: async () => {
      const connected = await connectWithWalletKit();
      set({ ...connected, isConnected: true });
    },

    connectWith: async (_type: WalletType) => {
      const connected = await connectWithWalletKit();
      set({ ...connected, isConnected: true });
    },

    disconnect: () => {
      void disconnectWalletKit().catch((error) => console.warn("Wallet disconnect failed:", error));
      set({ address: null, isConnected: false, walletType: null, networkPassphrase: null });
    },

    checkConnection: async () => {
      const connected = await restoreWalletKitConnection();
      if (connected) set({ ...connected, isConnected: true });
    },
  };
});
