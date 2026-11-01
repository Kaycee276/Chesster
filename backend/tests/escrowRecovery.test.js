process.env.COORDINATOR_SECRET_KEY = "dummy-secret-key";
process.env.ESCROW_CONTRACT_ADDRESS = "CCO5ZQKTAUJ4JXZLVK3NWE5RNWAT2KZDNEDP4NLN7AU35KK4VE7XGO4Q";
process.env.COORDINATOR_TX_MAX_RETRIES = "3";
process.env.COORDINATOR_TX_BASE_DELAY_MS = "1";
process.env.COORDINATOR_TX_MAX_DELAY_MS = "5";

const { Keypair, rpc, TransactionBuilder, Contract, xdr, scValToNative, nativeToScVal } = require("@stellar/stellar-sdk");
const escrowService = require("../services/escrowService");
const gameModel = require("../models/gameModel");
const supabase = require("../config/supabase");

jest.mock("@stellar/stellar-sdk", () => {
  return {
    Networks: { TESTNET: "Test SDF Network ; September 2015" },
    Keypair: {
      fromSecret: jest.fn().mockReturnValue({
        publicKey: jest.fn().mockReturnValue("GBELXTVUSO745SBIL6OINE3FR3YB4BTXKOL5BY7LK6GC5AOQJCZOVMBX"),
        sign: jest.fn(),
      }),
    },
    rpc: {
      Server: jest.fn().mockImplementation(() => ({
        getAccount: jest.fn().mockResolvedValue({
          sequenceNumber: () => "1000000",
        }),
        prepareTransaction: jest.fn().mockResolvedValue({
          sign: jest.fn(),
        }),
        sendTransaction: jest.fn().mockResolvedValue({
          status: "PENDING",
          hash: "test-hash",
        }),
        getTransaction: jest.fn().mockResolvedValue({
          status: "SUCCESS",
          resultMetaXdr: "mock_result_meta_xdr",
        }),
        simulateTransaction: jest.fn().mockResolvedValue({
          result: {
            retval: "mock-scval",
          },
          minResourceFee: "100000",
        }),
      })),
      Account: jest.fn(),
    },
    Contract: jest.fn().mockImplementation(() => ({
      call: jest.fn().mockReturnValue("mock-operation"),
    })),
    TransactionBuilder: Object.assign(
      jest.fn().mockImplementation(() => ({
        addOperation: jest.fn().mockReturnThis(),
        setTimeout: jest.fn().mockReturnThis(),
        build: jest.fn().mockReturnValue("mock-tx"),
      })),
      {
        buildFeeBumpTransaction: jest.fn().mockImplementation((source, fee, inner, network) => ({
          feeSource: typeof source === "object" && source.publicKey ? source.publicKey() : source,
          fee,
          innerTx: inner,
          networkPassphrase: network,
          sign: jest.fn(),
        })),
        BASE_FEE: 100,
        MIN_FEE: 100,
      }
    ),
    xdr: {
      ScVal: {
        scvVoid: jest.fn().mockReturnValue("mock-void"),
      },
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

jest.mock("../config/supabase", () => {
  const tableData = {
    games: [],
  };

  const createBuilder = (tableName) => {
    let selectedData = tableData[tableName] || [];
    let filterField = null;
    let filterVal = null;
    let updatePayload = null;

    const builder = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockImplementation((field, val) => {
        filterField = field;
        filterVal = val;
        return builder;
      }),
      update: jest.fn().mockImplementation((payload) => {
        updatePayload = payload;
        return builder;
      }),
      single: jest.fn().mockImplementation(() => {
        const item = selectedData.find((r) => !filterField || r[filterField] === filterVal);
        return Promise.resolve({ data: item || null, error: item ? null : { message: "Not found" } });
      }),
      then: (resolve, reject) => {
        if (updatePayload && filterField) {
          selectedData = selectedData.map((r) => {
            if (r[filterField] === filterVal) {
              return { ...r, ...updatePayload };
            }
            return r;
          });
          tableData[tableName] = selectedData;
        }
        return Promise.resolve({ data: selectedData, error: null }).then(resolve, reject);
      },
    };
    return builder;
  };

  return {
    from: jest.fn().mockImplementation((table) => createBuilder(table)),
    __tableData: tableData,
    __reset() {
      tableData.games = [];
    },
  };
});

describe("Escrow Recovery Simulation Tests", () => {
  let serverInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    escrowService.init();
    const results = rpc.Server.mock.results;
    serverInstance = results[results.length - 1].value;
  });

  describe("RPC Timeout and Polling Handling", () => {
    it("should poll getTransaction until SUCCESS when initially NOT_FOUND", async () => {
      let pollCount = 0;
      serverInstance.getTransaction.mockImplementation(() => {
        pollCount++;
        if (pollCount < 3) {
          return Promise.resolve({ status: "NOT_FOUND" });
        }
        return Promise.resolve({
          status: "SUCCESS",
          hash: "tx_polled_success",
        });
      });

      const res = await escrowService.resolveMatch("TEST_TIMEOUT", "GBELXTVUSO745SBIL6OINE3FR3YB4BTXKOL5BY7LK6GC5AOQJCZOVMBX");
      expect(res.status).toBe("SUCCESS");
      expect(pollCount).toBe(3);
    });

    it("should retry when sendTransaction throws a transient network timeout", async () => {
      let sendAttempts = 0;
      serverInstance.sendTransaction.mockImplementation(() => {
        sendAttempts++;
        if (sendAttempts < 2) {
          const timeoutErr = new Error("ETIMEDOUT: Connection timed out");
          return Promise.reject(timeoutErr);
        }
        return Promise.resolve({
          status: "PENDING",
          hash: "tx_recovered_hash",
        });
      });

      const res = await escrowService.resolveMatch("TEST_RETRY_NET", "GBELXTVUSO745SBIL6OINE3FR3YB4BTXKOL5BY7LK6GC5AOQJCZOVMBX");
      expect(res.status).toBe("SUCCESS");
      expect(sendAttempts).toBe(2);
    });
  });

  describe("HTTP 429 Rate Limiting & Backoff", () => {
    it("should retry and succeed when Soroban RPC returns HTTP 429", async () => {
      let attempts = 0;
      serverInstance.sendTransaction.mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          const err = new Error("Too Many Requests");
          err.response = { status: 429 };
          return Promise.reject(err);
        }
        return Promise.resolve({
          status: "PENDING",
          hash: "tx_rate_limit_recovered",
        });
      });

      const res = await escrowService.resolveMatch("TEST_429", "GBELXTVUSO745SBIL6OINE3FR3YB4BTXKOL5BY7LK6GC5AOQJCZOVMBX");
      expect(res.status).toBe("SUCCESS");
      expect(attempts).toBe(3);
    });

    it("should correctly identify retryable vs non-retryable HTTP error codes", () => {
      expect(escrowService.isRetryableError({ response: { status: 429 } })).toBe(true);
      expect(escrowService.isRetryableError({ response: { status: 502 } })).toBe(true);
      expect(escrowService.isRetryableError({ response: { status: 503 } })).toBe(true);
      expect(escrowService.isRetryableError({ response: { status: 504 } })).toBe(true);
      expect(escrowService.isRetryableError({ response: { status: 400 } })).toBe(false);
      expect(escrowService.isRetryableError({ response: { status: 404 } })).toBe(false);
    });
  });

  describe("Sequence Number Race Recovery (tx_bad_seq)", () => {
    it("should retry and recover on sequence-number conflict", async () => {
      let attempts = 0;
      serverInstance.sendTransaction.mockImplementation(() => {
        attempts++;
        if (attempts === 1) {
          const seqErr = new Error("tx_bad_seq");
          return Promise.reject(seqErr);
        }
        return Promise.resolve({
          status: "PENDING",
          hash: "tx_seq_recovered",
        });
      });

      const res = await escrowService.resolveMatch("TEST_SEQ", "GBELXTVUSO745SBIL6OINE3FR3YB4BTXKOL5BY7LK6GC5AOQJCZOVMBX");
      expect(res.status).toBe("SUCCESS");
      expect(attempts).toBe(2);
      expect(serverInstance.getAccount).toHaveBeenCalledTimes(2);
    });
  });

  describe("Refund After Abandoned Lobby", () => {
    it("should successfully trigger refundUnresolvedMatch for abandoned matches", async () => {
      const res = await escrowService.refundUnresolvedMatch("TEST_REFUND");
      expect(res.status).toBe("SUCCESS");
    });
  });

  describe("Database Status Transitions via _settleEscrow", () => {
    it("should mark match as settled when on-chain state is already RESOLVED", async () => {
      jest.spyOn(escrowService, "getMatch").mockResolvedValueOnce({
        status: 2, // RESOLVED
        createdAt: 1000n,
        player1: "PLAYER1",
        player2: "PLAYER2",
      });

      const updateSpy = jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({}) });
      jest.spyOn(supabase, "from").mockReturnValue({ update: updateSpy });

      await gameModel._settleEscrow("GAME_RESOLVED", { wager_amount: "10" }, "white");

      expect(updateSpy).toHaveBeenCalledWith({ escrow_status: "settled" });
    });

    it("should mark match as refunded when on-chain state is already REFUNDED", async () => {
      jest.spyOn(escrowService, "getMatch").mockResolvedValueOnce({
        status: 3, // REFUNDED
        createdAt: 1000n,
        player1: "PLAYER1",
        player2: "PLAYER2",
      });

      const updateSpy = jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({}) });
      jest.spyOn(supabase, "from").mockReturnValue({ update: updateSpy });

      await gameModel._settleEscrow("GAME_REFUNDED", { wager_amount: "10" }, "white");

      expect(updateSpy).toHaveBeenCalledWith({ escrow_status: "refunded" });
    });

    it("should refund match and transition to refunded when on-chain state is PENDING", async () => {
      jest.spyOn(escrowService, "getMatch").mockResolvedValueOnce({
        status: 0, // PENDING
        createdAt: 1000n,
        player1: "PLAYER1",
        player2: null,
      });

      jest.spyOn(escrowService, "refundUnresolvedMatch").mockResolvedValueOnce({
        status: "SUCCESS",
        hash: "refund_tx_123",
      });

      const updateSpy = jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({}) });
      jest.spyOn(supabase, "from").mockReturnValue({ update: updateSpy });

      await gameModel._settleEscrow("GAME_PENDING", { wager_amount: "10" }, "white");

      expect(updateSpy).toHaveBeenCalledWith({
        escrow_status: "refunded",
        escrow_resolve_tx: "refund_tx_123",
      });
    });

    it("should recover and mark settled if resolveMatch threw but on-chain recheck is RESOLVED", async () => {
      jest.spyOn(escrowService, "getMatch")
        .mockResolvedValueOnce({
          status: 1, // ACTIVE
          createdAt: 1000n,
          player1: "PLAYER1",
          player2: "PLAYER2",
        })
        .mockResolvedValueOnce({
          status: 2, // RESOLVED on recheck
          createdAt: 1000n,
          player1: "PLAYER1",
          player2: "PLAYER2",
        });

      jest.spyOn(escrowService, "resolveWithWinner").mockRejectedValueOnce(new Error("Timeout waiting for ledger"));

      const updateSpy = jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({}) });
      jest.spyOn(supabase, "from").mockReturnValue({ update: updateSpy });

      await gameModel._settleEscrow("GAME_RACE", { wager_amount: "10" }, "white");

      expect(updateSpy).toHaveBeenCalledWith({ escrow_status: "settled" });
    });

    it("should mark escrow as failed if resolveMatch throws and recheck is not resolved", async () => {
      jest.spyOn(escrowService, "getMatch")
        .mockResolvedValueOnce({
          status: 1, // ACTIVE
          createdAt: 1000n,
          player1: "PLAYER1",
          player2: "PLAYER2",
        })
        .mockResolvedValueOnce({
          status: 1, // Still ACTIVE on recheck
          createdAt: 1000n,
          player1: "PLAYER1",
          player2: "PLAYER2",
        });

      jest.spyOn(escrowService, "resolveWithWinner").mockRejectedValueOnce(new Error("RPC submission fatal error"));

      const updateSpy = jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({}) });
      jest.spyOn(supabase, "from").mockReturnValue({ update: updateSpy });

      await gameModel._settleEscrow("GAME_FAILED", { wager_amount: "10" }, "white");

      expect(updateSpy).toHaveBeenCalledWith({ escrow_status: "failed" });
    });
  });

  describe("Unhandled Rejections and Resource Cleanliness", () => {
    it("should not produce unhandled promise rejections during simulation", async () => {
      const rejections = [];
      const onUnhandled = (err) => rejections.push(err);
      process.on("unhandledRejection", onUnhandled);

      try {
        serverInstance.sendTransaction.mockRejectedValueOnce(new Error("Simulated network drop"));
        serverInstance.getAccount.mockRejectedValueOnce(new Error("Simulated account fetch error"));

        await expect(escrowService.resolveMatch("UNHANDLED_TEST", "GBELXTVUSO745SBIL6OINE3FR3YB4BTXKOL5BY7LK6GC5AOQJCZOVMBX")).rejects.toThrow();
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(rejections).toHaveLength(0);
      } finally {
        process.removeListener("unhandledRejection", onUnhandled);
      }
    });
  });
});
