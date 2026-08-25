/**
 * Tests for Stellar Horizon Transaction Indexer
 */

const escrowService = require("../services/escrowService");

jest.mock("axios");
const axios = require("axios");

describe("Stellar Horizon Transaction Indexer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("verifyDepositTransaction", () => {
    test("should verify a valid payment transaction", async () => {
      const mockTransaction = {
        hash: "test-hash-123",
        successful: true,
        created_at: new Date().toISOString(),
        ledger_attr: 12345,
        _links: {
          operations: {
            href: "https://horizon-testnet.stellar.org/transactions/test-hash-123/operations"
          }
        }
      };

      const mockOperations = {
        data: {
          records: [
            {
              type: "payment",
              asset_type: "native",
              amount: "100.0000000",
              from: "GTEST...",
              to: "GRECEIVER..."
            }
          ]
        }
      };

      axios.get
        .mockResolvedValueOnce({ data: mockTransaction })
        .mockResolvedValueOnce(mockOperations);

      const result = await escrowService.verifyDepositTransaction(
        "test-hash-123",
        "XLM",
        100
      );

      expect(result.verified).toBe(true);
      expect(result.hash).toBe("test-hash-123");
      expect(result.asset).toBe("XLM");
      expect(result.amount).toBe(100);
    });

    test("should reject failed transactions", async () => {
      axios.get.mockResolvedValueOnce({
        data: {
          hash: "test-hash-123",
          successful: false
        }
      });

      const result = await escrowService.verifyDepositTransaction(
        "test-hash-123"
      );

      expect(result.verified).toBe(false);
      expect(result.reason).toContain("not found or not successful");
    });

    test("should reject transactions with no payment operations", async () => {
      const mockTransaction = {
        hash: "test-hash-123",
        successful: true,
        _links: {
          operations: {
            href: "https://horizon-testnet.stellar.org/transactions/test-hash-123/operations"
          }
        }
      };

      const mockOperations = {
        data: { records: [] }
      };

      axios.get
        .mockResolvedValueOnce({ data: mockTransaction })
        .mockResolvedValueOnce(mockOperations);

      const result = await escrowService.verifyDepositTransaction(
        "test-hash-123"
      );

      expect(result.verified).toBe(false);
      expect(result.reason).toContain("No payment operations");
    });

    test("should handle HTTP errors gracefully", async () => {
      axios.get.mockRejectedValueOnce(new Error("Network error"));

      const result = await escrowService.verifyDepositTransaction(
        "invalid-hash"
      );

      expect(result.verified).toBe(false);
      expect(result.reason).toBeDefined();
    });

    test("should include source and destination in result", async () => {
      const mockTransaction = {
        hash: "test-hash-123",
        successful: true,
        created_at: new Date().toISOString(),
        ledger_attr: 12345,
        _links: {
          operations: {
            href: "https://horizon-testnet.stellar.org/transactions/test-hash-123/operations"
          }
        }
      };

      const mockOperations = {
        data: {
          records: [
            {
              type: "payment",
              asset_type: "native",
              amount: "50.0000000",
              from: "GSENDER123...",
              to: "GRECEIVER456..."
            }
          ]
        }
      };

      axios.get
        .mockResolvedValueOnce({ data: mockTransaction })
        .mockResolvedValueOnce(mockOperations);

      const result = await escrowService.verifyDepositTransaction(
        "test-hash-123"
      );

      expect(result.source).toBe("GSENDER123...");
      expect(result.destination).toBe("GRECEIVER456...");
    });
  });

  describe("getHorizonTransactions", () => {
    test("should fetch transactions for an account", async () => {
      const mockTransactions = {
        records: [
          {
            hash: "tx-1",
            created_at: new Date().toISOString(),
            ledger_attr: 100
          },
          {
            hash: "tx-2",
            created_at: new Date().toISOString(),
            ledger_attr: 101
          }
        ]
      };

      axios.get.mockResolvedValueOnce({ data: mockTransactions });

      const result = await escrowService.getHorizonTransactions("GACCOUNT...");

      expect(result).toHaveLength(2);
      expect(result[0].hash).toBe("tx-1");
      expect(result[1].hash).toBe("tx-2");
    });

    test("should handle empty transaction list", async () => {
      axios.get.mockResolvedValueOnce({ data: { records: [] } });

      const result = await escrowService.getHorizonTransactions("GACCOUNT...");

      expect(result).toEqual([]);
    });

    test("should handle network errors", async () => {
      axios.get.mockRejectedValueOnce(new Error("Network timeout"));

      const result = await escrowService.getHorizonTransactions("GACCOUNT...");

      expect(result).toEqual([]);
    });

    test("should limit results to 10 transactions", async () => {
      axios.get.mockResolvedValueOnce({ data: { records: [] } });

      await escrowService.getHorizonTransactions("GACCOUNT...");

      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining("GACCOUNT"),
        expect.objectContaining({
          params: expect.objectContaining({
            limit: 10
          })
        })
      );
    });
  });

  describe("validateEscrowDeposit", () => {
    test("should validate a recent deposit", async () => {
      const txData = {
        verified: true,
        hash: "tx-123",
        source: "GSENDER...",
        amount: 50,
        asset: "XLM",
        timestamp: new Date().toISOString()
      };

      const result = await escrowService.validateEscrowDeposit(
        txData,
        "GAME-001"
      );

      expect(result.valid).toBe(true);
      expect(result.gameCode).toBe("GAME-001");
      expect(result.amount).toBe(50);
    });

    test("should reject unverified deposits", async () => {
      const txData = {
        verified: false,
        hash: "tx-123"
      };

      const result = await escrowService.validateEscrowDeposit(
        txData,
        "GAME-001"
      );

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("not verified");
    });

    test("should reject old deposits", async () => {
      // Transaction from 2 hours ago
      const oldTime = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      
      const txData = {
        verified: true,
        hash: "tx-123",
        source: "GSENDER...",
        amount: 50,
        asset: "XLM",
        timestamp: oldTime
      };

      const result = await escrowService.validateEscrowDeposit(
        txData,
        "GAME-001"
      );

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("too old");
    });

    test("should include deposit details in result", async () => {
      const now = new Date().toISOString();
      const txData = {
        verified: true,
        hash: "tx-123",
        source: "GSENDER...",
        amount: 100,
        asset: "XLM",
        timestamp: now
      };

      const result = await escrowService.validateEscrowDeposit(
        txData,
        "GAME-001"
      );

      expect(result.source).toBe("GSENDER...");
      expect(result.amount).toBe(100);
      expect(result.asset).toBe("XLM");
      expect(result.timestamp).toBe(now);
    });
  });

  describe("createTransactionIndexer", () => {
    test("should create an indexer instance", () => {
      const indexer = escrowService.createTransactionIndexer(
        "GACCOUNT...",
        () => {}
      );

      expect(indexer).toHaveProperty("start");
      expect(indexer).toHaveProperty("stop");
      expect(indexer).toHaveProperty("isRunning");
      expect(indexer).toHaveProperty("sync");
    });

    test("should track running state", () => {
      const indexer = escrowService.createTransactionIndexer(
        "GACCOUNT...",
        () => {}
      );

      expect(indexer.isRunning()).toBe(false);
    });

    test("should provide sync method", async () => {
      const mockTransactions = {
        records: [
          { hash: "tx-1", ledger_attr: 100 },
          { hash: "tx-2", ledger_attr: 101 }
        ]
      };

      axios.get.mockResolvedValueOnce({ data: mockTransactions });

      const indexer = escrowService.createTransactionIndexer(
        "GACCOUNT...",
        () => {}
      );

      const result = await indexer.sync();

      expect(result).toHaveLength(2);
    });

    test("should call callback on new transaction", async () => {
      const callback = jest.fn();
      const indexer = escrowService.createTransactionIndexer(
        "GACCOUNT...",
        callback
      );

      expect(typeof callback).toBe("function");
    });
  });

  describe("Error Handling", () => {
    test("should handle missing transaction data", async () => {
      axios.get.mockResolvedValueOnce({ data: null });

      const result = await escrowService.verifyDepositTransaction("unknown-tx");

      expect(result.verified).toBe(false);
    });

    test("should handle malformed Horizon responses", async () => {
      axios.get.mockResolvedValueOnce({ data: { error: "Invalid request" } });

      // Should not throw, just return unverified
      const result = await escrowService.verifyDepositTransaction("tx-hash");

      expect(result.verified).toBe(false);
    });
  });
});
