function parseCodes(value, defaults) {
  const source = value === undefined ? defaults : String(value).split(",");
  return new Set(source.map((code) => code.trim().toUpperCase()).filter(Boolean));
}

const RESTRICTED_COUNTRIES = parseCodes(process.env.RESTRICTED_WAGER_COUNTRIES, [
  "CU",
  "IR",
  "KP",
  "SY",
]);

const RESTRICTED_REGIONS = parseCodes(process.env.RESTRICTED_WAGER_REGIONS, [
  "US-HI",
  "US-ID",
  "US-LA",
  "US-MI",
  "US-MT",
  "US-NV",
  "US-WA",
]);

const TRUSTED_PROXIES = String(process.env.TRUSTED_PROXIES || "loopback")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

module.exports = { RESTRICTED_COUNTRIES, RESTRICTED_REGIONS, TRUSTED_PROXIES };
