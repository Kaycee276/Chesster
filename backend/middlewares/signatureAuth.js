let Keypair;
try {
  Keypair = require("stellar-sdk").Keypair;
} catch (e) {
  Keypair = require("@stellar/stellar-sdk").Keypair;
}

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

module.exports = {
  verifyRequestSignature,
  verifyStellarSignature: (publicKey, message, signatureBase64) => {
    const keypair = Keypair.fromPublicKey(publicKey);
    const signatureBytes = Buffer.from(signatureBase64, "base64");
    return keypair.verify(Buffer.from(message), signatureBytes);
  },
};
