const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const { requireAuth } = require("../middleware/authMiddleware");
const { createAuthChallengeRateLimiter } = require("../middleware/rateLimiter");

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

module.exports = router;
