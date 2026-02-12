const express = require('express');
const router = express.Router();
const gameController = require('../controllers/gameController');

router.post('/games', gameController.createGame);
router.post('/games/:gameCode/join', gameController.joinGame);
router.get('/games/:gameCode', gameController.getGame);
router.post('/games/:gameCode/move', gameController.makeMove);
router.get('/games/:gameCode/moves', gameController.getMoves);
router.post('/games/:gameCode/resign', gameController.resignGame);
router.post('/games/:gameCode/draw/offer', gameController.offerDraw);
router.post('/games/:gameCode/draw/accept', gameController.acceptDraw);

module.exports = router;
