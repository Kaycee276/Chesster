const express = require("express");
const { requireAuth } = require("../middleware/authMiddleware");
const referralService = require("../services/referralService");

const router = express.Router();

router.get("/stats", requireAuth, async (req, res) => {
	try {
		const stats = await referralService.getStats(req.user.address);
		res.json({ success: true, data: stats });
	} catch (error) {
		res.status(400).json({ success: false, error: error.message });
	}
});

router.post("/claim", requireAuth, async (req, res) => {
	try {
		const claim = await referralService.claimCommission(req.user.address);
		res.status(202).json({ success: true, data: claim });
	} catch (error) {
		res.status(400).json({ success: false, error: error.message });
	}
});

module.exports = router;
