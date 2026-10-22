const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const { requireAuth } = require("../middleware/authMiddleware");
const { createAuthChallengeRateLimiter } = require("../middleware/rateLimiter");
const { webhookAuth } = require("../middleware/webhookAuth");

// Dedicated sliding-window limiter on top of the global API limiter: caps
// nonce generation per IP and per wallet address to blunt challenge-flooding
// DoS attempts (Issue #435).
const authChallengeRateLimiter = createAuthChallengeRateLimiter();

router.post("/auth/challenge", authChallengeRateLimiter, authController.createChallenge);
router.post("/auth/login", authController.login);
router.get("/auth/profile", requireAuth, authController.getProfile);
router.put("/auth/profile", requireAuth, authController.updateProfile);
router.post("/users/delete-account", requireAuth, authController.deleteAccount);
router.get("/users/:address/profile", authController.getPublicProfile);

// Inbound webhook ingress route for external provider notifications
// (e.g., Stellar indexer transaction confirmations or wallet provider events - Issue #581)
router.post("/auth/webhook", webhookAuth, (req, res) => {
  res.status(200).json({ success: true, message: "Webhook accepted", data: req.body });
});

module.exports = router;
