const crypto = require("crypto");

const COOKIE_NAME = "XSRF-TOKEN";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const CSRF_SECRET = process.env.CSRF_SECRET || process.env.JWT_SECRET || "chesster-csrf-secret-key-fallback";

function generateSignedToken() {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(16).toString("hex");
  const payload = `${timestamp}.${random}`;
  const hmac = crypto.createHmac("sha256", CSRF_SECRET).update(payload).digest("hex");
  return `${payload}.${hmac}`;
}

function verifySignedToken(token) {
  if (typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [timestampStr, random, hmac] = parts;
  const payload = `${timestampStr}.${random}`;
  const expectedHmac = crypto.createHmac("sha256", CSRF_SECRET).update(payload).digest("hex");

  if (hmac.length !== expectedHmac.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expectedHmac))) {
    return false;
  }

  const timestamp = parseInt(timestampStr, 36);
  if (
    Number.isNaN(timestamp) ||
    Date.now() - timestamp > 24 * 60 * 60 * 1000 ||
    timestamp > Date.now() + 60 * 1000
  ) {
    return false;
  }

  return true;
}

function readCookies(header = "") {
  return Object.fromEntries(
    header.split(";").flatMap((part) => {
      const separator = part.indexOf("=");
      if (separator < 0) return [];
      return [
        [part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())],
      ];
    })
  );
}

function setCsrfCookie(res, token) {
  const isProd = process.env.NODE_ENV === "production";
  const cookieParts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    isProd ? "SameSite=None" : "SameSite=Lax",
    "Max-Age=86400",
  ];
  if (isProd) cookieParts.push("Secure");
  const cookieString = cookieParts.join("; ");

  const existing = res.getHeader("Set-Cookie");
  if (!existing) {
    res.setHeader("Set-Cookie", cookieString);
  } else if (Array.isArray(existing)) {
    const filtered = existing.filter((c) => !c.startsWith(`${COOKIE_NAME}=`));
    res.setHeader("Set-Cookie", [...filtered, cookieString]);
  } else if (typeof existing === "string") {
    if (existing.startsWith(`${COOKIE_NAME}=`)) {
      res.setHeader("Set-Cookie", cookieString);
    } else {
      res.setHeader("Set-Cookie", [existing, cookieString]);
    }
  }
}

function csrfProtection(req, res, next) {
  const cookies = readCookies(req.headers.cookie);
  let token = cookies[COOKIE_NAME];

  if (!token || !verifySignedToken(token)) {
    token = generateSignedToken();
    setCsrfCookie(res, token);
  }

  req.csrfToken = token;

  if (SAFE_METHODS.has(req.method)) return next();

  const headerToken = req.headers["x-xsrf-token"];
  if (typeof headerToken !== "string" || !headerToken) {
    return res.status(403).json({ success: false, error: "CSRF token validation failed" });
  }

  // 1. Matches cookie token (standard double-submit pattern)
  const matchesCookie =
    token &&
    headerToken.length === token.length &&
    crypto.timingSafeEqual(Buffer.from(headerToken), Buffer.from(token));

  // 2. Or is a valid HMAC-signed token issued by this server (cross-origin SPA)
  const isValidSigned = verifySignedToken(headerToken);

  if (!matchesCookie && !isValidSigned) {
    return res.status(403).json({ success: false, error: "CSRF token validation failed" });
  }

  return next();
}

module.exports = {
  COOKIE_NAME,
  csrfProtection,
  readCookies,
  setCsrfCookie,
  generateSignedToken,
  verifySignedToken,
};
