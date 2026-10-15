const helmet = require("helmet");

/**
 * Strict Content-Security-Policy (CSP) middleware for Chesster (Issue #325 & Issue #444).
 * Enforces origin isolation, blocks unauthorized framing, allows Stockfish WASM compilation
 * with 'wasm-unsafe-eval', and restricts connection endpoints to Stellar RPC/Horizon nodes.
 */
function createCspMiddleware() {
  const isProduction = process.env.NODE_ENV === "production";

  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: isProduction
          ? ["'self'", "'wasm-unsafe-eval'"]
          : ["'self'", "'wasm-unsafe-eval'", "'unsafe-inline'", "'unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        connectSrc: [
          "'self'",
          "wss:",
          "ws:",
          "https://horizon.stellar.org",
          "https://horizon-testnet.stellar.org",
          "https://soroban-testnet.stellar.org",
          "https://*.stellar.org",
          "https://*.supabase.co",
        ],
        fontSrc: ["'self'", "data:"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: isProduction ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  });
}

module.exports = {
  createCspMiddleware,
};
