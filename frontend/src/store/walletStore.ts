import { create } from "zustand";
import { connectWithWalletKit, disconnectWalletKit } from "../services/walletKit";
import {
  checkAutoConnect,
  clearSession,
  markConnected,
  rememberWalletType,
  subscribeSessionStatus,
  type SessionStatus,
} from "../services/walletService";

export type WalletType = string;

interface WalletState {
  address: string | null;
  isConnected: boolean;
  walletType: WalletType | null;
  networkPassphrase: string | null;
  sessionStatus: SessionStatus;
  connect: () => Promise<void>;
  connectWith: (type: WalletType) => Promise<void>;
  disconnect: () => void;
  checkConnection: () => Promise<void>;
}

export const useWalletStore = create<WalletState>((set) => {
  async function establish() {
    const connected = await connectWithWalletKit();
    rememberWalletType(connected.walletType);
    markConnected();
    set({ ...connected, isConnected: true, sessionStatus: "connected" });
  }

  return {
    address: null,
    isConnected: false,
    walletType: null,
    networkPassphrase: null,
    sessionStatus: "disconnected",

    connect: establish,

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    connectWith: async (_type: WalletType) => establish(),

    disconnect: () => {
      void disconnectWalletKit().catch((error) => console.warn("Wallet disconnect failed:", error));
      clearSession();
      set({ address: null, isConnected: false, walletType: null, networkPassphrase: null, sessionStatus: "disconnected" });
    },

    checkConnection: async () => {
      set({ sessionStatus: "reauthenticating" });
      const connected = await checkAutoConnect();
      if (connected) {
        markConnected();
        set({ ...connected, isConnected: true, sessionStatus: "connected" });
      } else {
        set({ sessionStatus: "disconnected" });
      }
    },
  };
});

// Keep the store in sync with silent token refresh outcomes.
subscribeSessionStatus((sessionStatus) => {
  useWalletStore.setState({ sessionStatus });
});
