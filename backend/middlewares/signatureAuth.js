let Keypair;
try {
  Keypair = require("stellar-sdk").Keypair;
} catch (e) {
  Keypair = require("@stellar/stellar-sdk").Keypair;
}

const { getRedisClient } = require("../config/redis");

const inMemorySeenNonces = new Map();

/**
 * Middleware: Verify Request Signature on Relayed Meta-Transactions (Issue #323)
 * Protects endpoints from replay attacks and unauthorized meta-transactions by enforcing
 * Ed25519 signature verification against the sender's Stellar public key.
 */
function verifyRequestSignature(options = {}) {
  const maxWindowMs = options.maxWindowMs || 5 * 60 * 1000; // 5 minutes

  return (req, res, next) => {
    try {
      const signature =
        req.headers["x-signature"] ||
        req.headers["x-signature-ed25519"] ||
        req.headers["signature"];
      const timestamp =
        req.headers["x-timestamp"] ||
        req.headers["timestamp"];
      const publicKey =
        req.headers["x-public-key"] ||
        req.headers["x-wallet-public-key"] ||
        req.body?.publicKey ||
        req.body?.playerPublicKey ||
        req.body?.walletAddress;

      if (!signature || !timestamp || !publicKey) {
        return res.status(401).json({
          error: "Missing required signature authentication headers (X-Signature, X-Timestamp, X-Public-Key)",
        });
      }

      const parsedTimestamp = Number(timestamp);
      if (isNaN(parsedTimestamp)) {
        return res.status(401).json({ error: "Invalid timestamp header" });
      }

      const currentTime = Date.now();
      if (Math.abs(currentTime - parsedTimestamp) > maxWindowMs) {
        return res.status(401).json({
          error: "Request timestamp is outside the allowed replay window (5 minutes)",
        });
      }

      // Reconstruct canonical message
      const bodyContent =
        typeof req.body === "object" && req.body !== null
          ? JSON.stringify(req.body)
          : req.body || "";

      // Canonical string format: METHOD:PATH:TIMESTAMP:BODY
      const targetPath = req.originalUrl || req.baseUrl + req.path || req.path;
      const canonicalMessage = `${req.method.toUpperCase()}:${targetPath}:${parsedTimestamp}:${bodyContent}`;

      // Also support simplified path if originalUrl differs
      const simpleMessage = `${req.method.toUpperCase()}:${req.path}:${parsedTimestamp}:${bodyContent}`;

      let verified = false;
      let keypair;
      try {
        keypair = Keypair.fromPublicKey(publicKey);
      } catch (err) {
        return res.status(401).json({ error: "Invalid Stellar public key format" });
      }

      let signatureBuffer;
      try {
        // Try base64 decoding first, fallback to hex
        if (/^[0-9a-fA-F]+$/.test(signature) && signature.length === 128) {
          signatureBuffer = Buffer.from(signature, "hex");
        } else {
          signatureBuffer = Buffer.from(signature, "base64");
        }
      } catch (err) {
        return res.status(401).json({ error: "Invalid signature encoding" });
      }

      try {
        verified = keypair.verify(Buffer.from(canonicalMessage), signatureBuffer);
        if (!verified && canonicalMessage !== simpleMessage) {
          verified = keypair.verify(Buffer.from(simpleMessage), signatureBuffer);
        }
        // Also support plain message of body JSON if signed directly
        if (!verified) {
          verified = keypair.verify(Buffer.from(bodyContent), signatureBuffer);
        }
      } catch (err) {
        return res.status(401).json({ error: "Signature verification failed" });
      }

      if (!verified) {
        return res.status(401).json({ error: "Invalid request signature" });
      }

      req.authenticatedPublicKey = publicKey;
      return next();
    } catch (err) {
      return res.status(401).json({ error: "Signature verification error: " + err.message });
    }
  };
}

/**
 * Middleware: Verify Cryptographic Signature on Escrow Coordinator Callbacks (Issue #445)
 * Enforces strict 60-second temporal freshness and single-use nonce tracking via Redis
 * to prevent settlement replay attacks.
 */
function verifyCoordinatorSignature(options = {}) {
  const maxWindowMs = options.maxWindowMs ?? 60000; // 60 seconds
  const nonceTtlSeconds = options.nonceTtlSeconds ?? 300; // 5 minutes TTL
  const coordinatorPublicKey = options.coordinatorPublicKey || process.env.COORDINATOR_PUBLIC_KEY;

  return async (req, res, next) => {
    try {
      const signature =
        req.headers["x-chesster-signature"] ||
        req.headers["x-signature"];
      const timestamp =
        req.headers["x-chesster-timestamp"] ||
        req.headers["x-timestamp"];
      const nonce =
        req.headers["x-chesster-nonce"] ||
        req.headers["x-nonce"];
      const publicKey =
        req.headers["x-chesster-public-key"] ||
        req.headers["x-public-key"] ||
        coordinatorPublicKey;

      if (!signature || !timestamp || !nonce) {
        return res.status(401).json({ error: "Missing security headers" });
      }

      const parsedTimestamp = Number(timestamp);
      if (isNaN(parsedTimestamp)) {
        return res.status(401).json({ error: "Invalid timestamp header" });
      }

      const now = Date.now();
      if (Math.abs(now - parsedTimestamp) > maxWindowMs) {
        return res.status(401).json({ error: "Request signature expired" });
      }

      const redis = options.redisClient || getRedisClient();
      const redisKey = `coordinator:nonce:${nonce}`;

      if (redis) {
        const acquired = await redis.set(redisKey, "1", "EX", nonceTtlSeconds, "NX");
        if (!acquired || (acquired !== "OK" && acquired !== true)) {
          return res.status(409).json({ error: "Replay detected: nonce already processed" });
        }
      } else {
        const nowSec = Math.floor(now / 1000);
        if (inMemorySeenNonces.has(redisKey)) {
          const exp = inMemorySeenNonces.get(redisKey);
          if (exp > nowSec) {
            return res.status(409).json({ error: "Replay detected: nonce already processed" });
          }
        }
        inMemorySeenNonces.set(redisKey, nowSec + nonceTtlSeconds);
      }

      if (!publicKey) {
        return res.status(401).json({ error: "Missing coordinator public key" });
      }

      let keypair;
      try {
        keypair = Keypair.fromPublicKey(publicKey);
      } catch (err) {
        return res.status(401).json({ error: "Invalid Stellar public key format" });
      }

      const bodyStr =
        typeof req.body === "object" && req.body !== null
          ? JSON.stringify(req.body)
          : req.body || "";
      const message = `${timestamp}.${nonce}.${bodyStr}`;

      let signatureBuffer;
      try {
        if (/^[0-9a-fA-F]+$/.test(signature) && signature.length === 128) {
          signatureBuffer = Buffer.from(signature, "hex");
        } else {
          signatureBuffer = Buffer.from(signature, "base64");
        }
      } catch (err) {
        return res.status(401).json({ error: "Invalid signature encoding" });
      }

      let isValid = false;
      try {
        isValid = keypair.verify(Buffer.from(message), signatureBuffer);
      } catch (err) {
        return res.status(403).json({ error: "Invalid cryptographic signature" });
      }

      if (!isValid) {
        return res.status(403).json({ error: "Invalid cryptographic signature" });
      }

      req.authenticatedCoordinator = publicKey;
      next();
    } catch (err) {
      return res.status(500).json({ error: "Coordinator signature verification error: " + err.message });
    }
  };
}

module.exports = {
  verifyRequestSignature,
  verifyCoordinatorSignature,
  verifyStellarSignature: (publicKey, message, signatureBase64) => {
    const keypair = Keypair.fromPublicKey(publicKey);
    const signatureBytes = Buffer.from(signatureBase64, "base64");
    return keypair.verify(Buffer.from(message), signatureBytes);
  },
};
