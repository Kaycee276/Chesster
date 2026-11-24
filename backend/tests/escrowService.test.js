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
    Operation: {
      payment: jest.fn().mockImplementation((opts) => ({ type: "payment", ...opts })),
    },
    Asset: {
      native: jest.fn().mockReturnValue({ code: "XLM" }),
    },
    Memo: {
      text: jest.fn().mockImplementation((value) => ({ type: "text", value })),
    },
    TransactionBuilder: Object.assign(
      jest.fn().mockImplementation(() => ({
        addOperation: jest.fn().mockReturnThis(),
        addMemo: jest.fn().mockReturnThis(),
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
    escrowService.resetUserSponsorship();
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

  describe("fee sponsorship & fee bump builder (Issue #289)", () => {
    it("builds and signs a fee bump transaction with coordinator by default", () => {
      const mockInner = { operations: [1], fee: "100" };
      const feeBumpTx = escrowService.buildFeeBumpTransaction(mockInner, { fee: "250" });
      expect(feeBumpTx).toBeDefined();
      expect(TransactionBuilder.buildFeeBumpTransaction).toHaveBeenCalled();
      expect(feeBumpTx.sign).toHaveBeenCalled();
    });

    it("sponsors an unfunded player transaction and records gas audit log", async () => {
      const mockInner = { operations: [1], fee: "100" };
      const user = "GBELXTVUSO745SBIL6OINE3FR3YB4BTXKOL5BY7LK6GC5AOQJCZOVMBX";

      const feeBumpTx = await escrowService.sponsorTransaction(mockInner, user, {
        fee: "300",
        gameCode: "GAME123",
      });

      expect(feeBumpTx).toBeDefined();
      expect(escrowService.getUserSponsorshipTotal(user)).toBe(300);

      const logs = escrowService.getMatchAuditLogs("GAME123");
      expect(logs).toHaveLength(1);
      expect(logs[0].player_address).toBe(user);
      expect(logs[0].event_type).toBe("SPONSORED_GAS_EXPENDITURE");
      expect(logs[0].event_data.fee_stroops).toBe("300");
    });

    it("enforces maximum fee sponsorship cap per user", async () => {
      const mockInner = { operations: [1], fee: "100" };
      const user = "GUNFUNDEDUSER123";

      // Cap is 10,000,000 stroops
      await escrowService.sponsorTransaction(mockInner, user, {
        fee: "9999900",
        gameCode: "GAME123",
      });

      // Next sponsorship pushes past cap -> throws error
      await expect(
        escrowService.sponsorTransaction(mockInner, user, {
          fee: "200",
          gameCode: "GAME123",
        }),
      ).rejects.toThrow(/Sponsorship cap of .* stroops exceeded/);
    });

    it("rejects sponsorship without user address", async () => {
      const mockInner = { operations: [1], fee: "100" };
      await expect(escrowService.sponsorTransaction(mockInner, null)).rejects.toThrow(
        "User address required for fee sponsorship",
      );
    });
  });

  describe("withRenewableLock (Issue #703)", () => {
    let mockRedis;

    beforeEach(() => {
      mockRedis = {
        set: jest.fn(),
        expire: jest.fn(),
        eval: jest.fn(),
      };
    });

    it("acquires a lock and releases it after function completes", async () => {
      mockRedis.set.mockResolvedValueOnce("OK");
      mockRedis.eval.mockResolvedValueOnce(1);

      const fn = jest.fn().mockResolvedValueOnce("result");
      const result = await escrowService.withRenewableLock(mockRedis, "lock:test", "worker1", 30, fn);

      expect(mockRedis.set).toHaveBeenCalledWith("lock:test", "worker1", "NX", "EX", 30);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(result).toBe("result");
      expect(mockRedis.eval).toHaveBeenCalled();
    });

    it("throws when lock acquisition fails", async () => {
      mockRedis.set.mockResolvedValueOnce(null);

      const fn = jest.fn();
      await expect(escrowService.withRenewableLock(mockRedis, "lock:test", "worker1", 30, fn))
        .rejects
        .toThrow(/Failed to acquire lock/);
      expect(fn).not.toHaveBeenCalled();
    });

    it("renews the lock periodically while function is running", async () => {
      mockRedis.set.mockResolvedValueOnce("OK");
      mockRedis.expire.mockResolvedValue(1);
      mockRedis.eval.mockResolvedValueOnce(1);

      let resolveFn;
      const fn = jest.fn(() => new Promise(resolve => { resolveFn = resolve; }));

      const promise = escrowService.withRenewableLock(mockRedis, "lock:test", "worker1", 0.3, fn);

      await new Promise(r => setTimeout(r, 250));
      resolveFn("done");

      await promise;

      expect(mockRedis.expire).toHaveBeenCalledWith("lock:test", 0.3);
      expect(mockRedis.eval).toHaveBeenCalled();
    });

    it("clears renewal interval even if function throws", async () => {
      mockRedis.set.mockResolvedValueOnce("OK");
      mockRedis.expire.mockResolvedValue(1);
      mockRedis.eval.mockResolvedValueOnce(1);

      const error = new Error("function failed");
      const fn = jest.fn().mockRejectedValueOnce(error);

      await expect(escrowService.withRenewableLock(mockRedis, "lock:test", "worker1", 30, fn))
        .rejects
        .toThrow("function failed");

      expect(mockRedis.eval).toHaveBeenCalled();
    });

    it("validates required parameters", async () => {
      const fn = jest.fn();

      await expect(escrowService.withRenewableLock(null, "lock", "worker", 30, fn))
        .rejects
        .toThrow("missing required arguments");

      await expect(escrowService.withRenewableLock(mockRedis, null, "worker", 30, fn))
        .rejects
        .toThrow("missing required arguments");
    });
  });

  describe("idempotent settlement coordinator (Issue #645)", () => {
    const { OptimisticLockError } = require("../database/transactionRetry");
    const {
      settleMatchWithIdempotency,
      checkOnChainStatus,
      createMemoryLedger,
      createSupabaseLedger,
      SettlementInProgressError,
      MatchNotActiveError,
      ON_CHAIN_STATUS,
    } = escrowService;

    /** Shared-state Redis fake: SET NX EX, EXPIRE and the compare-and-delete release script. */
    function createFakeRedis() {
      const store = new Map();
      return {
        store,
        set: jest.fn(async (key, value, ...opts) => {
          await Promise.resolve();
          if (opts.includes("NX") && store.has(key)) return null;
          store.set(key, value);
          return "OK";
        }),
        expire: jest.fn(async () => 1),
        eval: jest.fn(async (_script, _n, key, owner) => {
          await Promise.resolve();
          if (store.get(key) === owner) {
            store.delete(key);
            return 1;
          }
          return 0;
        }),
      };
    }

    const active = async () => ({ status: ON_CHAIN_STATUS.ACTIVE, isActive: true, isFinal: false });
    const resolved = async () => ({ status: ON_CHAIN_STATUS.RESOLVED, isActive: false, isFinal: true });
    const pendingOnChain = async () => ({ status: ON_CHAIN_STATUS.PENDING, isActive: false, isFinal: false });
    const noRetryDelay = { retry: { sleepFn: async () => {} } };

    it("runs the settlement once and records it as confirmed in the ledger", async () => {
      const redis = createFakeRedis();
      const ledger = createMemoryLedger();
      const settle = jest.fn().mockResolvedValue({ hash: "tx-1" });

      const result = await settleMatchWithIdempotency("GAME1", settle, { redis, ledger, checkStatus: active, ...noRetryDelay });

      expect(result).toMatchObject({ matchId: "GAME1", status: "confirmed", txHash: "tx-1", idempotent: false, alreadySettled: false });
      expect(settle).toHaveBeenCalledTimes(1);
      expect(await ledger.find("GAME1")).toMatchObject({ status: "confirmed", tx_hash: "tx-1", attempts: 1 });
      expect(redis.set).toHaveBeenCalledWith("lock:escrow:match:GAME1", expect.any(String), "NX", "EX", 30);
      expect(redis.store.has("lock:escrow:match:GAME1")).toBe(false); // lock released
    });

    it("lets exactly one of many concurrent settlements through (no double submission)", async () => {
      const redis = createFakeRedis();
      const ledger = createMemoryLedger();
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      const settle = jest.fn(async () => {
        await gate;
        return { hash: "tx-once" };
      });

      const attempts = Array.from({ length: 8 }, () =>
        settleMatchWithIdempotency("GAME2", settle, { redis, ledger, checkStatus: active, ...noRetryDelay }),
      );
      const pendingResults = Promise.allSettled(attempts); // attach handlers before any can reject
      // Let every contender reach the lock before the winner finishes.
      await new Promise((resolve) => setTimeout(resolve, 20));
      release();
      const results = await pendingResults;

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(settle).toHaveBeenCalledTimes(1);
      expect(fulfilled).toHaveLength(1);
      expect(fulfilled[0].value.txHash).toBe("tx-once");
      expect(rejected).toHaveLength(7);
      for (const r of rejected) expect(r.reason).toBeInstanceOf(SettlementInProgressError);
      expect(await ledger.find("GAME2")).toMatchObject({ status: "confirmed", tx_hash: "tx-once" });
    });

    it("returns the ledger entry without resubmitting once confirmed", async () => {
      const redis = createFakeRedis();
      const ledger = createMemoryLedger();
      const checkStatus = jest.fn(active);
      await settleMatchWithIdempotency("GAME3", async () => ({ hash: "tx-3" }), { redis, ledger, checkStatus, ...noRetryDelay });

      const settleAgain = jest.fn();
      const second = await settleMatchWithIdempotency("GAME3", settleAgain, { redis, ledger, checkStatus, ...noRetryDelay });

      expect(second).toMatchObject({ txHash: "tx-3", idempotent: true, alreadySettled: true });
      expect(settleAgain).not.toHaveBeenCalled();
      expect(checkStatus).toHaveBeenCalledTimes(1); // the second call never even queried the chain
    });

    it("does not settle a match that is already resolved on-chain and reconciles the ledger", async () => {
      const ledger = createMemoryLedger();
      const settle = jest.fn();

      const result = await settleMatchWithIdempotency("GAME4", settle, { redis: createFakeRedis(), ledger, checkStatus: resolved, ...noRetryDelay });

      expect(settle).not.toHaveBeenCalled();
      expect(result).toMatchObject({ idempotent: true, alreadySettled: true, onChainStatus: ON_CHAIN_STATUS.RESOLVED });
      expect(await ledger.find("GAME4")).toMatchObject({ status: "confirmed" });
    });

    it("reconciles a stale pending entry whose transaction landed before the worker died", async () => {
      const ledger = createMemoryLedger();
      await ledger.insertPending("GAME5"); // crashed worker left this behind
      const settle = jest.fn();

      const result = await settleMatchWithIdempotency("GAME5", settle, { redis: createFakeRedis(), ledger, checkStatus: resolved, ...noRetryDelay });

      expect(settle).not.toHaveBeenCalled();
      expect(result.alreadySettled).toBe(true);
      expect(await ledger.find("GAME5")).toMatchObject({ status: "confirmed" });
    });

    it("refuses to settle a match that is not Active on-chain", async () => {
      const ledger = createMemoryLedger();
      const settle = jest.fn();

      await expect(
        settleMatchWithIdempotency("GAME6", settle, { redis: createFakeRedis(), ledger, checkStatus: pendingOnChain, ...noRetryDelay }),
      ).rejects.toBeInstanceOf(MatchNotActiveError);

      expect(settle).not.toHaveBeenCalled();
      expect(await ledger.find("GAME6")).toBeNull();
    });

    it("marks a failed submission as failed, releases the lock and allows a later retry", async () => {
      const redis = createFakeRedis();
      const ledger = createMemoryLedger();
      const opts = { redis, ledger, checkStatus: active, ...noRetryDelay };

      await expect(
        settleMatchWithIdempotency("GAME7", jest.fn().mockRejectedValue(new Error("HostError: contract trapped")), opts),
      ).rejects.toThrow("HostError: contract trapped");
      expect(await ledger.find("GAME7")).toMatchObject({ status: "failed", last_error: "HostError: contract trapped" });
      expect(redis.store.has("lock:escrow:match:GAME7")).toBe(false);

      const result = await settleMatchWithIdempotency("GAME7", async () => ({ hash: "tx-7" }), opts);
      expect(result.txHash).toBe("tx-7");
      expect(await ledger.find("GAME7")).toMatchObject({ status: "confirmed", attempts: 2, last_error: null });
    });

    it("retries optimistic-lock conflicts on ledger updates with backoff", async () => {
      const base = createMemoryLedger();
      let conflicts = 1;
      const ledger = {
        ...base,
        update: jest.fn(async (...args) => {
          if (conflicts-- > 0) throw new OptimisticLockError();
          return base.update(...args);
        }),
      };
      const sleepFn = jest.fn(async () => {});

      const result = await settleMatchWithIdempotency("GAME8", async () => ({ hash: "tx-8" }), {
        redis: createFakeRedis(),
        ledger,
        checkStatus: active,
        retry: { sleepFn },
      });

      expect(result.status).toBe("confirmed");
      expect(sleepFn).toHaveBeenCalledTimes(1);
      expect(await base.find("GAME8")).toMatchObject({ status: "confirmed", tx_hash: "tx-8" });
    });

    it("still returns the receipt if the confirmation write fails after the transaction landed", async () => {
      const base = createMemoryLedger();
      const ledger = { ...base, update: jest.fn().mockRejectedValue(new Error("db down")) };
      const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

      const result = await settleMatchWithIdempotency("GAME9", async () => ({ hash: "tx-9" }), {
        redis: createFakeRedis(),
        ledger,
        checkStatus: active,
        retry: { maxRetries: 1, sleepFn: async () => {} },
      });

      expect(result).toMatchObject({ txHash: "tx-9", status: "confirmed" });
      errorSpy.mockRestore();
    });

    it("falls back to an in-process lock when Redis is unavailable", async () => {
      const ledger = createMemoryLedger();
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      const settle = jest.fn(async () => {
        await gate;
        return { hash: "tx-local" };
      });
      const opts = { redis: null, ledger, checkStatus: active, ...noRetryDelay };

      const first = settleMatchWithIdempotency("GAME10", settle, opts);
      await new Promise((resolve) => setTimeout(resolve, 10));
      await expect(settleMatchWithIdempotency("GAME10", settle, opts)).rejects.toBeInstanceOf(SettlementInProgressError);
      release();
      await expect(first).resolves.toMatchObject({ txHash: "tx-local" });
      expect(settle).toHaveBeenCalledTimes(1);
    });

    it("validates its arguments", async () => {
      await expect(settleMatchWithIdempotency("", jest.fn())).rejects.toThrow("matchId is required");
      await expect(settleMatchWithIdempotency("GAME11", null)).rejects.toThrow("settlementFn must be a function");
    });

    it("retries a txBAD_SEQ sequence collision with backoff during real submission", async () => {
      serverInstance.sendTransaction
        .mockRejectedValueOnce(new Error("txBAD_SEQ"))
        .mockResolvedValueOnce({ status: "PENDING", hash: "seq-hash" });

      const result = await settleMatchWithIdempotency("GAME12", () => escrowService.resolveWithWinner("GAME12", "PLAYER1"), {
        redis: createFakeRedis(),
        ledger: createMemoryLedger(),
        checkStatus: active,
        ...noRetryDelay,
      });

      expect(result.status).toBe("confirmed");
      expect(serverInstance.sendTransaction).toHaveBeenCalledTimes(2);
    });

    describe("checkOnChainStatus", () => {
      const match = (overrides) => ({
        game_code: "GAME1",
        player1: "P1",
        player2: "P2",
        wager_amount: 1n,
        total_staked: 2n,
        created_at: 1000n,
        status: 1,
        winner: null,
        ...overrides,
      });

      it("reports an Active match as settleable", async () => {
        scValToNative.mockReturnValueOnce(match({ status: 1 }));
        await expect(checkOnChainStatus("GAME1")).resolves.toMatchObject({ status: 1, exists: true, isActive: true, isFinal: false });
      });

      it("reports Resolved and Refunded matches as final", async () => {
        scValToNative.mockReturnValueOnce(match({ status: 2 }));
        await expect(checkOnChainStatus("GAME1")).resolves.toMatchObject({ isActive: false, isFinal: true });
        scValToNative.mockReturnValueOnce(match({ status: 3 }));
        await expect(checkOnChainStatus("GAME1")).resolves.toMatchObject({ isActive: false, isFinal: true });
      });

      it("treats a match that was never created as neither active nor final", async () => {
        scValToNative.mockReturnValueOnce(match({ status: 1, created_at: 0n }));
        await expect(checkOnChainStatus("GAME1")).resolves.toMatchObject({ exists: false, isActive: false, isFinal: false });
      });

      it("propagates RPC failures so settlement is not attempted blind", async () => {
        serverInstance.simulateTransaction.mockResolvedValueOnce({ error: "rpc down" });
        await expect(checkOnChainStatus("GAME1")).rejects.toThrow("Simulation failed");
      });
    });

    describe("createSupabaseLedger", () => {
      function fakeSupabase({ insertResult, updateResult, findResult } = {}) {
        const calls = { eq: [] };
        const builder = {
          select: jest.fn(() => builder),
          insert: jest.fn(() => builder),
          update: jest.fn(() => builder),
          eq: jest.fn((...args) => { calls.eq.push(args); return builder; }),
          single: jest.fn(async () => insertResult),
          maybeSingle: jest.fn(async () => findResult),
          then: (resolve) => resolve(updateResult),
        };
        return { client: { from: jest.fn(() => builder) }, builder, calls };
      }

      it("inserts a pending row and maps a unique violation to null", async () => {
        const ok = fakeSupabase({ insertResult: { data: { match_id: "G", status: "pending", version: 0 }, error: null } });
        await expect(createSupabaseLedger(ok.client).insertPending("G")).resolves.toMatchObject({ status: "pending" });
        expect(ok.client.from).toHaveBeenCalledWith("escrow_settlement_ledger");

        const dup = fakeSupabase({ insertResult: { data: null, error: { code: "23505" } } });
        await expect(createSupabaseLedger(dup.client).insertPending("G")).resolves.toBeNull();

        const broken = fakeSupabase({ insertResult: { data: null, error: { code: "XX000", message: "boom" } } });
        await expect(createSupabaseLedger(broken.client).insertPending("G")).rejects.toMatchObject({ code: "XX000" });
      });

      it("updates conditionally on the expected version and raises an optimistic lock error on 0 rows", async () => {
        const hit = fakeSupabase({ updateResult: { data: [{ match_id: "G", version: 4 }], error: null } });
        await createSupabaseLedger(hit.client).update("G", 3, { status: "confirmed" });
        expect(hit.builder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "confirmed", version: 4 }));
        expect(hit.calls.eq).toEqual(expect.arrayContaining([["match_id", "G"], ["version", 3]]));

        const miss = fakeSupabase({ updateResult: { data: [], error: null } });
        await expect(createSupabaseLedger(miss.client).update("G", 3, {})).rejects.toBeInstanceOf(OptimisticLockError);
      });

      it("finds a row by match id", async () => {
        const found = fakeSupabase({ findResult: { data: { match_id: "G", status: "confirmed" }, error: null } });
        await expect(createSupabaseLedger(found.client).find("G")).resolves.toMatchObject({ status: "confirmed" });
        const none = fakeSupabase({ findResult: { data: null, error: null } });
        await expect(createSupabaseLedger(none.client).find("G")).resolves.toBeNull();
      });
    });
  });

  describe("tournament buy-in refund pipeline (Issue #712)", () => {
    it("refunds a single tournament buy-in with a native payment operation and memo", async () => {
      const res = await escrowService.refundTournamentBuyIn("tourn-123", "GPLAYER1", 25);
      expect(res).toEqual({ hash: "test-hash" });
      expect(serverInstance.sendTransaction).toHaveBeenCalledTimes(1);
    });

    it("rejects invalid refund destination or non-positive amount", async () => {
      await expect(escrowService.refundTournamentBuyIn("t1", "", 10)).rejects.toThrow(/destination is required/);
      await expect(escrowService.refundTournamentBuyIn("t1", "GPLAYER1", 0)).rejects.toThrow(/amount must be positive/);
      await expect(escrowService.refundTournamentBuyIn("t1", "GPLAYER1", -5)).rejects.toThrow(/amount must be positive/);
    });

    it("serializes concurrent batch payments behind the sequence lock and reports per-entry outcomes", async () => {
      let inFlight = 0;
      let maxInFlight = 0;
      let callCount = 0;
      serverInstance.sendTransaction.mockImplementation(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        callCount += 1;
        await new Promise((r) => setTimeout(r, 2));
        inFlight -= 1;
        if (callCount === 3) {
          throw new Error("HostError: account does not exist");
        }
        return { status: "PENDING", hash: `hash-${callCount}` };
      });
      serverInstance.getTransaction.mockImplementation(async (hash) => ({
        status: "SUCCESS",
        hash,
      }));

      const entries = Array.from({ length: 7 }, (_, i) => ({
        wallet_address: `GPLAYER_${i + 1}`,
        amount: 15,
      }));

      const results = await escrowService.refundTournamentBatch("tourn-batch", entries, { batchSize: 5 });

      expect(maxInFlight).toBe(1);
      expect(results).toHaveLength(7);
      expect(results.filter((r) => r.ok)).toHaveLength(6);
      expect(results[2]).toMatchObject({
        wallet_address: "GPLAYER_3",
        ok: false,
        error: expect.stringMatching(/account does not exist/),
      });
    });
  });
});
