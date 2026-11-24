jest.mock("../config/supabase", () => ({}));
const { CronService } = require("../services/cronService");

describe("CronService monthly move partitions", () => {
  function setup() {
    const archival = { ensureMonthlyPartitionsExist: jest.fn().mockResolvedValue({ success: true }) };
    const service = new CronService({ archival });
    for (const method of ["dispatchTournamentReminders", "dispatchWinnerAnnouncements", "decayInactiveRatingDeviation", "cleanupAbandonedLobbies", "refreshTorNodes", "aggregateHourlyMetrics"]) {
      service[method] = jest.fn().mockResolvedValue({ success: true });
    }
    return { service, archival };
  }

  test("provisions at startup, once per month and on the first tick of the 1st", async () => {
    const { service, archival } = setup();
    await service.runScheduledTasks(new Date("2026-11-19T12:00:00Z"));
    await service.runScheduledTasks(new Date("2026-11-30T23:59:00Z"));
    expect(archival.ensureMonthlyPartitionsExist).toHaveBeenCalledTimes(1);
    const rollover = new Date("2026-12-01T00:00:00Z");
    await service.runScheduledTasks(rollover);
    await service.runScheduledTasks(new Date("2026-12-01T00:01:00Z"));
    expect(archival.ensureMonthlyPartitionsExist).toHaveBeenCalledTimes(2);
    expect(archival.ensureMonthlyPartitionsExist).toHaveBeenLastCalledWith(rollover);
  });

  test("retries failures on the next tick", async () => {
    const { service, archival } = setup();
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    archival.ensureMonthlyPartitionsExist.mockRejectedValueOnce(new Error("offline"));
    await service.runScheduledTasks(new Date("2026-12-01T00:00:00Z"));
    expect(service.lastPartitionMonth).toBeNull();
    await service.runScheduledTasks(new Date("2026-12-01T00:01:00Z"));
    expect(archival.ensureMonthlyPartitionsExist).toHaveBeenCalledTimes(2);
    log.mockRestore();
  });

  test("does not overlap partition checks", async () => {
    const { service, archival } = setup();
    let finish;
    archival.ensureMonthlyPartitionsExist.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const first = service.ensureMovePartitions(new Date("2026-12-01T00:00:00Z"));
    await service.ensureMovePartitions(new Date("2026-12-01T00:01:00Z"));
    expect(archival.ensureMonthlyPartitionsExist).toHaveBeenCalledTimes(1);
    finish({ success: true });
    await first;
    expect(service.partitionCheckPending).toBe(false);
  });
});
