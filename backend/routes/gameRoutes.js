const express = require('express');
const router = express.Router();
const gameController = require('../controllers/gameController');

router.post('/games', gameController.createGame);
router.post('/games/:gameCode/join', gameController.joinGame);
router.get('/games/:gameCode', gameController.getGame);
router.post('/games/:gameCode/move', gameController.makeMove);
router.get('/games/:gameCode/moves', gameController.getMoves);

module.exports = router;
