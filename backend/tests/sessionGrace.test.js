process.env.SUPABASE_URL = "http://localhost";
process.env.SUPABASE_ANON_KEY = "test-key";

jest.mock("../models/gameModel", () => ({
  forfeitByDisconnect: jest.fn(),
}));
jest.mock("../models/userModel", () => ({
  invalidateProfilesForGame: jest.fn().mockResolvedValue(undefined),
}));

const { SessionService, DISCONNECTION_GRACE_MS } = require("../services/sessionService");
const timerService = require("../services/timerService");
const gameModel = require("../models/gameModel");

const WHITE = "GWHITE_ADDRESS_1234567890";
const BLACK = "GBLACK_ADDRESS_1234567890";

function createIo() {
  const emit = jest.fn();
  const to = jest.fn(() => ({ emit }));
  return { io: { to }, to, emit };
}

describe("SessionService disconnection grace (Issue #580)", () => {
  let service;
  let mock;

  beforeEach(() => {
    jest.useFakeTimers();
    service = new SessionService();
    mock = createIo();
    service.setIo(mock.io);
  });

  afterEach(() => {
    service.resetLocalState();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  test("defaults to a 60 second grace period", () => {
    expect(DISCONNECTION_GRACE_MS).toBe(60000);
  });

  test("starting a grace notifies the room with the remaining grace time", () => {
    const result = service.startDisconnectionGrace("G1", WHITE, BLACK);

    expect(result.gracePeriodRemainingMs).toBe(60000);
    expect(mock.to).toHaveBeenCalledWith("G1");
    expect(mock.emit).toHaveBeenCalledWith("OPPONENT_DISCONNECTED", {
      gameId: "G1",
      playerAddress: WHITE,
      gracePeriodRemainingMs: 60000,
    });
    expect(service.getDisconnectionGraceStatus("G1", WHITE).active).toBe(true);
  });

  test("reports remaining time as the grace counts down", () => {
    service.startDisconnectionGrace("G1", WHITE, BLACK);
    jest.advanceTimersByTime(35000);
    const status = service.getDisconnectionGraceStatus("G1", WHITE);
    expect(status.active).toBe(true);
    expect(status.gracePeriodRemainingMs).toBe(25000);
  });

  test("reconnecting within the grace cancels it without forfeiting", async () => {
    const onTimeout = jest.fn();
    service.startDisconnectionGrace("G1", WHITE, BLACK, { onTimeout });

    jest.advanceTimersByTime(35000);
    expect(service.cancelDisconnectionGrace("G1", WHITE)).toBe(true);
    expect(mock.emit).toHaveBeenCalledWith("OPPONENT_RECONNECTED", {
      gameId: "G1",
      playerAddress: WHITE,
    });

    await jest.advanceTimersByTimeAsync(60000);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(service.getDisconnectionGraceStatus("G1", WHITE).active).toBe(false);
  });

  test("cancelling when no grace is pending is a silent no-op", () => {
    expect(service.cancelDisconnectionGrace("G1", WHITE)).toBe(false);
    expect(mock.emit).not.toHaveBeenCalled();
  });

  test("expiry invokes onTimeout once with the opponent as winner", async () => {
    const onTimeout = jest.fn().mockResolvedValue(undefined);
    service.startDisconnectionGrace("G1", WHITE, BLACK, { onTimeout });

    await jest.advanceTimersByTimeAsync(59999);
    expect(onTimeout).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onTimeout).toHaveBeenCalledWith({
      gameId: "G1",
      playerAddress: WHITE,
      opponentAddress: BLACK,
    });
    expect(service.getDisconnectionGraceStatus("G1", WHITE).active).toBe(false);
  });

  test("a failing onTimeout handler does not throw out of the timer", async () => {
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    service.startDisconnectionGrace("G1", WHITE, BLACK, {
      onTimeout: jest.fn().mockRejectedValue(new Error("boom")),
    });
    await jest.advanceTimersByTimeAsync(60000);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  test("restarting a grace replaces the previous timer", async () => {
    const onTimeout = jest.fn();
    service.startDisconnectionGrace("G1", WHITE, BLACK, { onTimeout });
    jest.advanceTimersByTime(30000);
    service.startDisconnectionGrace("G1", WHITE, BLACK, { onTimeout });

    await jest.advanceTimersByTimeAsync(30000);
    expect(onTimeout).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(30000);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  test("graces for different games and players are isolated", async () => {
    const t1 = jest.fn();
    const t2 = jest.fn();
    service.startDisconnectionGrace("G1", WHITE, BLACK, { onTimeout: t1 });
    service.startDisconnectionGrace("G2", WHITE, BLACK, { onTimeout: t2 });
    service.startDisconnectionGrace("G1", BLACK, WHITE, { onTimeout: jest.fn() });

    service.cancelDisconnectionGrace("G1", WHITE);
    await jest.advanceTimersByTimeAsync(60000);

    expect(t1).not.toHaveBeenCalled();
    expect(t2).toHaveBeenCalledTimes(1);
  });

  test("honours a custom grace duration", async () => {
    const onTimeout = jest.fn();
    const r = service.startDisconnectionGrace("G1", WHITE, BLACK, { graceMs: 5000, onTimeout });
    expect(r.gracePeriodRemainingMs).toBe(5000);
    await jest.advanceTimersByTimeAsync(5000);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  test("rejects missing identifiers", () => {
    expect(() => service.startDisconnectionGrace("", WHITE, BLACK)).toThrow();
    expect(() => service.startDisconnectionGrace("G1", WHITE, undefined)).toThrow();
  });
});

describe("Abandonment forfeit and escrow notification (Issue #580)", () => {
  afterEach(() => jest.clearAllMocks());

  test("forfeitForAbandonment records the forfeit, which settles escrow, and announces the result", async () => {
    const emit = jest.fn();
    timerService.io = { to: jest.fn(() => ({ emit })) };
    const game = {
      game_code: "G1",
      status: "finished",
      winner: BLACK,
      end_reason: "disconnect",
      player_white_address: WHITE,
      player_black_address: BLACK,
    };
    gameModel.forfeitByDisconnect.mockResolvedValue(game);

    const result = await timerService.forfeitForAbandonment("G1", "white");

    expect(gameModel.forfeitByDisconnect).toHaveBeenCalledWith("G1", "white");
    expect(result).toBe(game);
    expect(emit).toHaveBeenCalledWith("game_over", {
      gameCode: "G1",
      winner: "black",
      reason: "abandonment",
    });
    expect(emit).toHaveBeenCalledWith("game-update", game);
  });

  test("forfeitForAbandonment swallows persistence errors and returns null", async () => {
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    gameModel.forfeitByDisconnect.mockRejectedValue(new Error("db down"));
    await expect(timerService.forfeitForAbandonment("G1", "white")).resolves.toBeNull();
    errSpy.mockRestore();
  });
});
