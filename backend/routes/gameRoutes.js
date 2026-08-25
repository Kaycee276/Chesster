const express = require('express');
const router = express.Router();
const gameController = require('../controllers/gameController');

router.post('/games', gameController.createGame);
router.get('/time-controls', gameController.getTimeControls);
router.get('/games/pending', gameController.getPendingGames);
router.get('/games', gameController.getGameHistory);
router.post('/games/:gameCode/join', gameController.joinGame);
router.get('/games/:gameCode', gameController.getGame);
router.post('/games/:gameCode/move', gameController.makeMove);
router.get('/games/:gameCode/moves', gameController.getMoves);
router.post('/games/:gameCode/resign', gameController.resignGame);
router.post('/games/:gameCode/draw/offer', gameController.offerDraw);
router.post('/games/:gameCode/draw/accept', gameController.acceptDraw);
router.post('/games/:gameCode/undo/request', gameController.requestUndoMove);
router.post('/games/:gameCode/undo/accept', gameController.acceptUndoMove);
router.post('/games/:gameCode/undo/reject', gameController.rejectUndoMove);
router.get('/games/:gameCode/chat', gameController.getChatMessages);

module.exports = router;
