jest.mock("geoip-lite", () => ({ lookup: jest.fn() }));
jest.mock("../models/gameModel", () => ({ getGame: jest.fn() }));

const geoip = require("geoip-lite");
const gameModel = require("../models/gameModel");
const {
  enforceGeoCompliance,
  enforceExistingGameGeoCompliance,
  getClientIp,
} = require("../middleware/geoIpMiddleware");

function response() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function request({ wagerAmount = "10", remoteAddress = "127.0.0.1", forwardedFor } = {}) {
  return {
    body: { wagerAmount },
    headers: forwardedFor ? { "x-forwarded-for": forwardedFor } : {},
    socket: { remoteAddress },
    params: { gameCode: "GAME01" },
  };
}

describe("GeoIP wager compliance", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("allows free matches in a restricted country", () => {
    geoip.lookup.mockReturnValue({ country: "CU", region: "03" });
    const req = request({ wagerAmount: "0", forwardedFor: "152.206.0.1" });
    const res = response();
    const next = jest.fn();

    enforceGeoCompliance(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(geoip.lookup).not.toHaveBeenCalled();
  });

  test("blocks wager creation in a restricted country", () => {
    geoip.lookup.mockReturnValue({ country: "IR", region: "07" });
    const req = request({ forwardedFor: "5.160.0.1" });
    const res = response();
    const next = jest.fn();

    enforceGeoCompliance(req, res, next);

    expect(geoip.lookup).toHaveBeenCalledWith("5.160.0.1");
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: "RESTRICTED_JURISDICTION",
    }));
    expect(next).not.toHaveBeenCalled();
  });

  test("blocks wager creation in a restricted US state", () => {
    geoip.lookup.mockReturnValue({ country: "US", region: "WA" });
    const res = response();

    enforceGeoCompliance(request({ forwardedFor: "71.227.0.1" }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
  });

  test("ignores spoofed forwarded headers from untrusted peers", () => {
    const req = request({ remoteAddress: "203.0.113.10", forwardedFor: "5.160.0.1" });
    expect(getClientIp(req)).toBe("203.0.113.10");
  });

  test("checks the stored wager when joining an existing game", async () => {
    gameModel.getGame.mockResolvedValue({ wager_amount: "25" });
    geoip.lookup.mockReturnValue({ country: "KP", region: "00" });
    const res = response();
    const next = jest.fn();

    await enforceExistingGameGeoCompliance(
      request({ wagerAmount: undefined, forwardedFor: "175.45.176.1" }),
      res,
      next,
    );

    expect(gameModel.getGame).toHaveBeenCalledWith("GAME01");
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
