const express = require("express");
const { webhookAuth } = require("../middleware/webhookAuth");

const router = express.Router();

/**
 * Authenticated ingress for external event notifications (Issue #581).
 *
 * Requests reaching the handler have already passed HMAC-SHA256 verification.
 * The handler only acknowledges receipt; state transitions driven by these
 * events must be added behind this authenticated boundary.
 */
router.post("/ingress", webhookAuth, (req, res) => {
  res.status(202).json({ success: true, received: true });
});

module.exports = router;
