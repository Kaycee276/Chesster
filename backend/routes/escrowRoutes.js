const express = require("express");
const router = express.Router();
const escrowService = require("../services/escrowService");

escrowService.init();

/**
 * Health check
 */
router.get("/info", (req, res) => {
  res.json({
    ok: true,
    contract: process.env.ESCROW_CONTRACT_ADDRESS || null,
  });
});

/**
 * GET /api/escrow/:gameCode
 * Fetch match details from contract
 */
router.get("/:gameCode", async (req, res) => {
  try {
    const { gameCode } = req.params;
    const match = await escrowService.getMatch(gameCode);
    res.json({ success: true, data: match });
  } catch (err) {
    console.error("escrow/get", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/escrow/create
 * Creator starts match with wager
 * Body: { gameCode, tokenAddress, wagerAmount }
 */
router.post("/create", async (req, res) => {
  try {
    const { gameCode, tokenAddress, wagerAmount } = req.body;
    if (!gameCode || !tokenAddress || !wagerAmount) {
      return res.status(400).json({ error: "missing required fields" });
    }

    const receipt = await escrowService.createMatch(
      gameCode,
      tokenAddress,
      wagerAmount
    );

    res.json({
      success: true,
      txHash: receipt.hash,          // ethers v6: receipt.hash (was .transactionHash in v5)
      blockNumber: receipt.blockNumber,
    });
  } catch (err) {
    console.error("escrow/create", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/escrow/join
 * Joiner joins match (pulls same wager)
 * Body: { gameCode }
 */
router.post("/join", async (req, res) => {
  try {
    const { gameCode } = req.body;
    if (!gameCode) {
      return res.status(400).json({ error: "gameCode required" });
    }

    const receipt = await escrowService.joinMatch(gameCode);

    res.json({
      success: true,
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
    });
  } catch (err) {
    console.error("escrow/join", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/escrow/resolve
 * Coordinator resolves match after game ends
 * Body: { gameCode, winner } where winner is:
 *   - player address for winner
 *   - "draw" for draw (becomes DRAW_ADDRESS)
 *   - null/empty for draw
 */
router.post("/resolve", async (req, res) => {
  try {
    const { gameCode, winner } = req.body;
    if (!gameCode) {
      return res.status(400).json({ error: "gameCode required" });
    }

    let resolveAddress = winner;
    if (winner === "draw" || winner === null || winner === "") {
      resolveAddress = escrowService.DRAW_ADDRESS;
    }

    const receipt = await escrowService.resolveMatch(gameCode, resolveAddress);

    res.json({
      success: true,
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
    });
  } catch (err) {
    console.error("escrow/resolve", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
