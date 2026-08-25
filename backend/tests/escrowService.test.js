process.env.COORDINATOR_SECRET_KEY = "dummy-secret-key";
process.env.ESCROW_CONTRACT_ADDRESS = "CCO5ZQKTAUJ4JXZLVK3NWE5RNWAT2KZDNEDP4NLN7AU35KK4VE7XGO4Q";
// Keep retry backoff near-instant so retry tests run fast (Issue #47).
process.env.COORDINATOR_TX_MAX_RETRIES = "2";
process.env.COORDINATOR_TX_BASE_DELAY_MS = "1";
process.env.COORDINATOR_TX_MAX_DELAY_MS = "5";

const escrowService = require("../services/escrowService");
const { Keypair, rpc, TransactionBuilder, Contract, xdr, scValToNative, nativeToScVal } = require("@stellar/stellar-sdk");

jest.mock("@stellar/stellar-sdk", () => {
  return {
    Networks: { TESTNET: "Test SDF Network ; September 2015" },
    Keypair: {
      fromSecret: jest.fn().mockReturnValue({
        publicKey: jest.fn().mockReturnValue("GBELXTVUSO745SBIL6OINE3FR3YB4BTXKOL5BY7LK6GC5AOQJCZOVMBX"),
      }),
    },
    rpc: {
      Server: jest.fn().mockImplementation(() => ({
        getAccount: jest.fn().mockResolvedValue({}),
        prepareTransaction: jest.fn().mockResolvedValue({
          sign: jest.fn(),
        }),
        sendTransaction: jest.fn().mockResolvedValue({
          status: "PENDING",
          hash: "test-hash",
        }),
        getTransaction: jest.fn().mockResolvedValue({
          status: "SUCCESS",
        }),
        simulateTransaction: jest.fn().mockResolvedValue({
          result: {
            retval: "mock-scval",
          },
        }),
      })),
      Account: jest.fn(),
    },
    Contract: jest.fn().mockImplementation(() => ({
      call: jest.fn().mockReturnValue("mock-operation"),
    })),
    TransactionBuilder: jest.fn().mockImplementation(() => ({
      addOperation: jest.fn().mockReturnThis(),
      setTimeout: jest.fn().mockReturnThis(),
      build: jest.fn().mockReturnValue("mock-tx"),
    })),
    xdr: {
      ScVal: {
        scvVoid: jest.fn().mockReturnValue("mock-void"),
      }
    },
    scValToNative: jest.fn().mockReturnValue({
      game_code: "GAME123",
      player1: "PLAYER1",
      player2: "PLAYER2",
      wager_amount: 100n,
      total_staked: 200n,
      created_at: 1000n,
      status: 1,
      winner: null,
    }),
    nativeToScVal: jest.fn().mockReturnValue("mock-scval"),
  };
});

describe("Escrow Service", () => {
  let serverInstance;

  beforeEach(() => {
    escrowService.init();
    // Grab the mocked rpc.Server instance escrowService.init() just created,
    // so individual tests can override its method behavior.
    const results = rpc.Server.mock.results;
    serverInstance = results[results.length - 1].value;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("getMatch", () => {
    it("should fetch and parse match details correctly", async () => {
      const match = await escrowService.getMatch("GAME123");

      expect(match.gameCode).toBe("GAME123");
      expect(match.player1).toBe("PLAYER1");
      expect(match.wagerAmount).toBe("100");
      expect(match.status).toBe(1);
    });
  });

  describe("resolveWithWinner", () => {
    it("should resolve a match with a winner", async () => {
      const result = await escrowService.resolveWithWinner("GAME123", "PLAYER1");
      expect(result.status).toBe("SUCCESS");
    });
  });

  describe("resolveAsDraw", () => {
    it("should resolve a match as a draw", async () => {
      const result = await escrowService.resolveAsDraw("GAME123");
      expect(result.status).toBe("SUCCESS");
    });
  });

  describe("forfeitMatch (Issue #39)", () => {
    it("should submit a forfeit resolution for the disconnected player", async () => {
      const result = await escrowService.forfeitMatch("GAME123", "PLAYER1");
      expect(result.status).toBe("SUCCESS");
    });
  });

  describe("estimateFee (Issue #47 — gas estimation)", () => {
    it("falls back to a default fee when simulation has no resource-fee estimate", async () => {
      serverInstance.simulateTransaction.mockResolvedValueOnce({ result: { retval: "mock-scval" } });
      const fee = await escrowService.estimateFee({}, "mock-operation");
      expect(fee).toBe("100000");
    });

    it("derives a fee from the simulated resource fee plus safety margin", async () => {
      serverInstance.simulateTransaction.mockResolvedValueOnce({ minResourceFee: "50000" });
      const fee = await escrowService.estimateFee({}, "mock-operation");
      // 50000 * 1.2 margin = 60000
      expect(fee).toBe("60000");
    });

    it("falls back to the default fee when simulation errors", async () => {
      serverInstance.simulateTransaction.mockResolvedValueOnce({ error: "simulation blew up" });
      const fee = await escrowService.estimateFee({}, "mock-operation");
      expect(fee).toBe("100000");
    });

    it("falls back to the default fee when simulation rejects", async () => {
      serverInstance.simulateTransaction.mockRejectedValueOnce(new Error("RPC unreachable"));
      const fee = await escrowService.estimateFee({}, "mock-operation");
      expect(fee).toBe("100000");
    });
  });

  describe("isRetryableError (Issue #47 — retry classification)", () => {
    it("treats network/timeout errors as retryable", () => {
      expect(escrowService.isRetryableError(new Error("ECONNRESET"))).toBe(true);
      expect(escrowService.isRetryableError(new Error("request timed out"))).toBe(true);
      expect(escrowService.isRetryableError(new Error("socket hang up"))).toBe(true);
    });

    it("treats a sequence-number race as retryable", () => {
      expect(escrowService.isRetryableError(new Error("tx_bad_seq"))).toBe(true);
    });

    it("treats HTTP 429/503 responses as retryable", () => {
      expect(escrowService.isRetryableError({ response: { status: 429 }, message: "rate limited" })).toBe(true);
      expect(escrowService.isRetryableError({ response: { status: 503 }, message: "unavailable" })).toBe(true);
    });

    it("treats a contract-level rejection as non-retryable", () => {
      expect(escrowService.isRetryableError(new Error("HostError: contract trapped"))).toBe(false);
      expect(escrowService.isRetryableError(new Error("Escrow contract not configured"))).toBe(false);
    });
  });

  describe("automated retry on transient failure (Issue #47)", () => {
    it("retries a transient send failure and succeeds on the next attempt", async () => {
      serverInstance.sendTransaction
        .mockRejectedValueOnce(new Error("ECONNRESET"))
        .mockResolvedValueOnce({ status: "PENDING", hash: "retry-hash" });

      const result = await escrowService.resolveWithWinner("GAME123", "PLAYER1");

      expect(result.status).toBe("SUCCESS");
      expect(serverInstance.sendTransaction).toHaveBeenCalledTimes(2);
      // A fresh account/sequence number is fetched on every attempt.
      expect(serverInstance.getAccount).toHaveBeenCalledTimes(2);
    });

    it("does not retry a non-retryable (contract-level) failure", async () => {
      serverInstance.sendTransaction.mockRejectedValue(new Error("HostError: contract trapped"));

      await expect(escrowService.resolveWithWinner("GAME123", "PLAYER1")).rejects.toThrow(
        "HostError: contract trapped",
      );
      expect(serverInstance.sendTransaction).toHaveBeenCalledTimes(1);
    });

    it("gives up after exhausting retries on a persistent transient failure", async () => {
      serverInstance.sendTransaction.mockRejectedValue(new Error("ETIMEDOUT"));

      await expect(escrowService.resolveWithWinner("GAME123", "PLAYER1")).rejects.toThrow("ETIMEDOUT");
      // MAX_RETRIES=2 (env override above) => 3 total attempts (initial + 2 retries).
      expect(serverInstance.sendTransaction).toHaveBeenCalledTimes(3);
    });
  });
});
