import type { BrowserContext, Page } from "@playwright/test";

export const MOCK_FREIGHTER_ADDRESS = "GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI";

export interface MockFreighterOptions {
  initiallyConnected?: boolean;
}

export interface MockFreighterApi {
  isConnected: () => Promise<boolean>;
  getPublicKey: () => Promise<string>;
  signAuthEntry: (entryXdr?: string) => Promise<{ signedAuthEntry: string }>;
}

/**
 * Injects a synthetic window.freighterApi and window postMessage listener
 * to mock the Stellar Freighter wallet extension deterministically in Playwright.
 */
export async function injectMockFreighter(
  target: Page | BrowserContext,
  address: string = MOCK_FREIGHTER_ADDRESS,
  options: MockFreighterOptions = {},
): Promise<void> {
  const initiallyConnected = options.initiallyConnected ?? false;

  await target.addInitScript(
    ({ mockAddress, autoConnect }) => {
      let isConnectedState = autoConnect;

      // Synthetic window.freighterApi object
      (window as unknown as { freighterApi: MockFreighterApi }).freighterApi = {
        isConnected: async () => isConnectedState,
        getPublicKey: async () => mockAddress,
        signAuthEntry: async () => ({ signedAuthEntry: "MOCK_SIGNATURE" }),
      };

      // Injected flag recognized by @stellar/freighter-api isConnected()
      if (isConnectedState) {
        (window as unknown as { freighter: boolean }).freighter = true;
      }

      // Intercept and reply to message events used by @stellar/freighter-api
      window.addEventListener("message", (event: MessageEvent) => {
        if (!event.data || event.data.source !== "FREIGHTER_EXTERNAL_MSG_REQUEST") {
          return;
        }

        const messageId = event.data.messageId;
        const msgType = event.data.type;

        if (msgType === "REQUEST_ACCESS") {
          isConnectedState = true;
          (window as unknown as { freighter: boolean }).freighter = true;
          window.postMessage(
            {
              source: "FREIGHTER_EXTERNAL_MSG_RESPONSE",
              messagedId: messageId,
              publicKey: mockAddress,
              address: mockAddress,
              isConnected: true,
              isAllowed: true,
            },
            "*",
          );
          return;
        }

        if (msgType === "REQUEST_CONNECTION_STATUS") {
          window.postMessage(
            {
              source: "FREIGHTER_EXTERNAL_MSG_RESPONSE",
              messagedId: messageId,
              isConnected: isConnectedState,
            },
            "*",
          );
          return;
        }

        // Generic response for other Freighter requests (REQUEST_PUBLIC_KEY, etc.)
        window.postMessage(
          {
            source: "FREIGHTER_EXTERNAL_MSG_RESPONSE",
            messagedId: messageId,
            publicKey: mockAddress,
            address: mockAddress,
            isConnected: isConnectedState,
            isAllowed: isConnectedState,
            networkDetails: {
              network: "TESTNET",
              networkName: "Test SDF Network",
              networkUrl: "https://horizon-testnet.stellar.org",
              networkPassphrase: "Test SDF Network ; September 2015",
            },
            signedAuthEntry: "MOCK_SIGNATURE",
          },
          "*",
        );
      });
    },
    { mockAddress: address, autoConnect: initiallyConnected },
  );
}
