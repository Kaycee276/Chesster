const express = require("express");
const router = express.Router();
const botController = require("../controllers/botController");

router.post("/bot/move", botController.getMove);
router.post("/games/:gameCode/bot-move", botController.playBotMove);

module.exports = router;
