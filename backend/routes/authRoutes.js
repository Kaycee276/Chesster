const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const { requireAuth } = require("../middleware/authMiddleware");

router.post("/auth/challenge", authController.createChallenge);
router.post("/auth/login", authController.login);
router.get("/auth/profile", requireAuth, authController.getProfile);
router.put("/auth/profile", requireAuth, authController.updateProfile);
router.post("/users/delete-account", requireAuth, authController.deleteAccount);
router.get("/users/:address/profile", authController.getPublicProfile);

module.exports = router;
