const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const { requireAuth } = require("../middleware/authMiddleware");

router.post("/auth/challenge", authController.createChallenge);
router.post("/auth/login", authController.login);
router.get("/auth/profile", requireAuth, authController.getProfile);
router.put("/auth/profile", requireAuth, authController.updateProfile);

module.exports = router;
