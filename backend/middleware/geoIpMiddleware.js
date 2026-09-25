const geoip = require("geoip-lite");
const proxyaddr = require("proxy-addr");
const gameModel = require("../models/gameModel");
const {
  RESTRICTED_COUNTRIES,
  RESTRICTED_REGIONS,
  TRUSTED_PROXIES,
} = require("../config/compliance");

const trustProxy = proxyaddr.compile(TRUSTED_PROXIES);

function normalizeIp(ip) {
  const value = String(ip || "").trim();
  return value.startsWith("::ffff:") ? value.slice(7) : value;
}

function getClientIp(req) {
  const remoteAddress = normalizeIp(req.socket?.remoteAddress || req.connection?.remoteAddress || req.ip);
  const forwardedFor = req.headers?.["x-forwarded-for"];

  if (remoteAddress && forwardedFor && trustProxy(remoteAddress, 0)) {
    return normalizeIp(String(forwardedFor).split(",")[0]);
  }
  return remoteAddress;
}

function isWagered(value) {
  if (value === undefined || value === null || value === "") return false;
  if (typeof value === "bigint") return value !== 0n;
  if (typeof value === "number") return Number.isFinite(value) && value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim();
    if (/^[+-]?\d+$/.test(normalized)) return BigInt(normalized) !== 0n;
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(normalized)) return Number(normalized) !== 0;
  }
  return true;
}

function applyGeoCheck(req, res, next, wagerAmount) {
  if (!isWagered(wagerAmount)) return next();

  const ip = getClientIp(req);
  const location = ip ? geoip.lookup(ip) : null;
  const country = String(location?.country || "").toUpperCase();
  const region = String(location?.region || "").toUpperCase();
  const regionCode = country && region ? `${country}-${region}` : "";

  req.geoLocation = location || null;
  if (RESTRICTED_COUNTRIES.has(country) || RESTRICTED_REGIONS.has(regionCode)) {
    return res.status(403).json({
      success: false,
      error: "Wagered games are restricted in your region.",
      code: "RESTRICTED_JURISDICTION",
    });
  }
  return next();
}

function enforceGeoCompliance(req, res, next) {
  return applyGeoCheck(req, res, next, req.body?.wagerAmount ?? req.body?.wager_amount);
}

async function enforceExistingGameGeoCompliance(req, res, next) {
  try {
    const game = await gameModel.getGame(req.params.gameCode);
    return applyGeoCheck(req, res, next, game?.wager_amount ?? game?.wagerAmount);
  } catch (error) {
    return res.status(503).json({
      success: false,
      error: "Unable to verify wager jurisdiction.",
      code: "COMPLIANCE_CHECK_UNAVAILABLE",
    });
  }
}

module.exports = {
  enforceGeoCompliance,
  enforceExistingGameGeoCompliance,
  getClientIp,
  isWagered,
};
