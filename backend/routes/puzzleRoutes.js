const express = require("express");
const puzzleController = require("../controllers/puzzleController");
const { requireAuth } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/adaptive", puzzleController.getAdaptivePuzzle);
router.get("/daily", puzzleController.puzzleCacheControlMiddleware(300, 60), puzzleController.getDailyPuzzle);
router.post("/:id/verify", requireAuth, puzzleController.verifyPuzzleSolution);

module.exports = router;
