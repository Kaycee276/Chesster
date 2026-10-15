/**
 * Fetch Metadata Request Headers and Origin Security Middleware
 *
 * Enforces W3C Fetch Metadata policies (Sec-Fetch-Site, Sec-Fetch-Mode, Sec-Fetch-Dest)
 * to defend against Cross-Site Request Forgery (CSRF), Cross-Site Script Inclusion (XSSI),
 * and unauthorized cross-origin state-mutating requests (POST, PUT, PATCH, DELETE).
 *
 * References:
 * - W3C Fetch Metadata Request Headers: https://www.w3.org/TR/fetch-metadata/
 * - OWASP Cross-Site Request Forgery Prevention Cheat Sheet
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const ALLOWED_FETCH_SITES = new Set(["same-origin", "same-site", "none"]);

const DEFAULT_EXEMPT_PATHS = [
  "/health",
  "/health/liveness",
  "/health/readiness",
  "/health/detailed",
  "/api/health",
  "/api/health/liveness",
  "/api/health/readiness",
  "/api/health/detailed",
  "/api/status",
  "/api/status/database",
  "/api/status/stellar",
  "/api/webhooks",
  "/webhooks",
];

/**
 * Checks whether a given request path matches any entry in the exempt paths list.
 * Supports exact string match, prefix match (with trailing slash), or RegExp.
 *
 * @param {string} path - Request path (e.g., req.path)
 * @param {Array<string|RegExp>} exemptPaths - Array of exempt paths or regexes
 * @returns {boolean}
 */
function isPathExempt(path, exemptPaths = DEFAULT_EXEMPT_PATHS) {
  if (!path || !Array.isArray(exemptPaths)) return false;
  return exemptPaths.some((exempt) => {
    if (typeof exempt === "string") {
      return path === exempt || path.startsWith(`${exempt}/`);
    }
    if (exempt instanceof RegExp) {
      return exempt.test(path);
    }
    return false;
  });
}

/**
 * Factory function to create Fetch Metadata middleware with custom configuration.
 *
 * @param {Object} options
 * @param {Array<string|RegExp>} [options.exemptPaths] - List of routes exempted from cross-site blocking
 * @param {Function} [options.isExempt] - Custom callback `(req) => boolean` for dynamic exemptions
 * @param {Array<string>} [options.allowedOrigins] - Explicitly allowed origins for cross-site calls
 * @returns {Function} Express middleware
 */
function createFetchMetadataMiddleware(options = {}) {
  const exemptPaths = options.exemptPaths || DEFAULT_EXEMPT_PATHS;
  const customIsExempt = options.isExempt;
  const allowedOrigins = Array.isArray(options.allowedOrigins) ? options.allowedOrigins : null;

  return function fetchMetadataPolicy(req, res, next) {
    const requestPath = req.path || (req.originalUrl ? req.originalUrl.split("?")[0] : "");

    // 1. Check custom or path exemptions (e.g. webhooks, public health probes)
    if (typeof customIsExempt === "function" && customIsExempt(req)) {
      return next();
    }
    if (isPathExempt(requestPath, exemptPaths)) {
      return next();
    }

    // 2. Allow safe read-only methods (GET, HEAD, OPTIONS)
    if (SAFE_METHODS.has(req.method)) {
      return next();
    }

    // 3. Inspect Sec-Fetch-Site header
    const secFetchSite = req.headers["sec-fetch-site"];

    // If browser/client does not support or provide Sec-Fetch-Site (e.g. curl, legacy clients), pass through
    if (!secFetchSite) {
      return next();
    }

    // 4. Allow trusted fetch sites: same-origin, same-site, or user-initiated none
    if (ALLOWED_FETCH_SITES.has(secFetchSite)) {
      return next();
    }

    // 5. Allow if request origin is in explicitly allowedOrigins list (if configured)
    const origin = req.headers.origin;
    if (allowedOrigins && origin && allowedOrigins.includes(origin)) {
      return next();
    }

    // 6. Reject mutating cross-site requests with HTTP 403 Forbidden
    return res.status(403).json({
      error: "Forbidden: Cross-site request rejected by fetch metadata policy",
    });
  };
}

const fetchMetadataPolicy = createFetchMetadataMiddleware();

module.exports = {
  fetchMetadataPolicy,
  fetchMetadata: fetchMetadataPolicy,
  createFetchMetadataMiddleware,
  DEFAULT_EXEMPT_PATHS,
  isPathExempt,
};
