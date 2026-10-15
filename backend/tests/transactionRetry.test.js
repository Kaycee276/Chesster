const { executeWithRetry, isTransientConflictError } = require("../database/transactionRetry");

describe("Automatic Transaction Deadlock Retry Routine (Issue #443)", () => {
  it("detects transient conflict errors accurately", () => {
    expect(isTransientConflictError({ code: "40P01" })).toBe(true);
    expect(isTransientConflictError({ code: "40001" })).toBe(true);
    expect(isTransientConflictError({ code: "P2034" })).toBe(true);
    expect(isTransientConflictError({ message: "deadlock detected" })).toBe(true);
    expect(isTransientConflictError({ message: "could not serialize access due to concurrent update" })).toBe(true);
    expect(isTransientConflictError({ message: "Transaction failed due to a write conflict or a deadlock" })).toBe(true);

    expect(isTransientConflictError(null)).toBe(false);
    expect(isTransientConflictError(new Error("Connection reset by peer"))).toBe(false);
    expect(isTransientConflictError({ code: "23505" })).toBe(false); // Unique violation
  });

  it("succeeds on first attempt when no conflicts occur", async () => {
    const fn = jest.fn().mockResolvedValue({ id: "success-1" });
    const result = await executeWithRetry(fn);
    expect(result).toEqual({ id: "success-1" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("recovers successfully after transient 40P01 deadlock errors", async () => {
    const error = new Error("deadlock detected");
    error.code = "40P01";

    let attempts = 0;
    const fn = jest.fn().mockImplementation(async () => {
      attempts++;
      if (attempts <= 2) throw error;
      return { success: true, attempts };
    });

    const sleepFn = jest.fn().mockResolvedValue();
    const onRetry = jest.fn();

    const result = await executeWithRetry(fn, {
      maxRetries: 5,
      baseDelayMs: 10,
      sleepFn,
      onRetry,
      context: "test-deadlock",
    });

    expect(result).toEqual({ success: true, attempts: 3 });
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleepFn).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenLastCalledWith(
      expect.objectContaining({
        attempt: 2,
        maxRetries: 5,
        context: "test-deadlock",
      })
    );
  });

  it("recovers successfully after Prisma P2034 write conflict", async () => {
    const prismaError = new Error("P2034: Transaction failed due to a write conflict or a deadlock");
    prismaError.code = "P2034";

    let attempts = 0;
    const fn = jest.fn().mockImplementation(async () => {
      attempts++;
      if (attempts === 1) throw prismaError;
      return "recovered";
    });

    const sleepFn = jest.fn().mockResolvedValue();
    const result = await executeWithRetry(fn, {
      maxRetries: 3,
      baseDelayMs: 5,
      sleepFn,
    });

    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(sleepFn).toHaveBeenCalledTimes(1);
  });

  it("throws immediately on non-transient errors without retrying", async () => {
    const syntaxError = new Error("syntax error at or near 'SELECT'");
    syntaxError.code = "42601";

    const fn = jest.fn().mockRejectedValue(syntaxError);
    const sleepFn = jest.fn();

    await expect(
      executeWithRetry(fn, { maxRetries: 5, sleepFn })
    ).rejects.toThrow("syntax error at or near 'SELECT'");

    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleepFn).not.toHaveBeenCalled();
  });

  it("throws error after exhausting maxRetries on persistent conflicts", async () => {
    const deadlock = new Error("deadlock detected");
    deadlock.code = "40P01";

    const fn = jest.fn().mockRejectedValue(deadlock);
    const sleepFn = jest.fn().mockResolvedValue();

    await expect(
      executeWithRetry(fn, { maxRetries: 4, baseDelayMs: 10, sleepFn })
    ).rejects.toThrow("deadlock detected");

    expect(fn).toHaveBeenCalledTimes(4);
    expect(sleepFn).toHaveBeenCalledTimes(3);
  });
});
