const crypto = require("crypto");

const COOKIE_NAME = "XSRF-TOKEN";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

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
  const attributes = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "SameSite=Lax",
    "Max-Age=86400",
  ];
  if (process.env.NODE_ENV === "production") attributes.push("Secure");
  res.setHeader("Set-Cookie", attributes.join("; "));
}

function csrfProtection(req, res, next) {
  const cookies = readCookies(req.headers.cookie);
  let token = cookies[COOKIE_NAME];

  if (!token) {
    token = crypto.randomBytes(32).toString("hex");
    setCsrfCookie(res, token);
  }

  if (SAFE_METHODS.has(req.method)) return next();

  const headerToken = req.headers["x-xsrf-token"];
  if (
    typeof headerToken !== "string" ||
    headerToken.length !== token.length ||
    !crypto.timingSafeEqual(Buffer.from(headerToken), Buffer.from(token))
  ) {
    return res.status(403).json({ success: false, error: "CSRF token validation failed" });
  }

  return next();
}

module.exports = { COOKIE_NAME, csrfProtection, readCookies, setCsrfCookie };
