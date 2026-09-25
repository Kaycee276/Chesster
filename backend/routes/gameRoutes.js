const express = require('express');
const router = express.Router();
const gameController = require('../controllers/gameController');
const { createRateLimiter } = require('../middleware/rateLimiter');
const {
	enforceGeoCompliance,
	enforceExistingGameGeoCompliance,
} = require('../middleware/geoIpMiddleware');

/**
 * IP Rate limiter for match creation (Issue #151).
 * Restricts match creation to 5 matches per IP per hour to prevent lobby flooding
 * and denial-of-service through empty games.
 */
const matchCreationLimiter = createRateLimiter({
	windowMs: 60 * 60 * 1000,
	max: 5,
	message: 'Too many matches created from this IP, please try again after an hour.',
});

// Export limiter instance for unit test state resetting
router.matchCreationLimiter = matchCreationLimiter;

/**
 * @openapi
 * /api/games:
 *   post:
 *     summary: Create a new game match
 *     description: Creates a new chess match with optional crypto wager. Rate limited to 5 matches per IP per hour.
 *     tags: [Games]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateGameRequest'
 *     responses:
 *       201:
 *         description: Game created successfully
 *       400:
 *         description: Invalid input or wager amount
 *       429:
 *         description: Rate limit exceeded
 */
router.post('/games', enforceGeoCompliance, matchCreationLimiter, gameController.createGame);

/**
 * @openapi
 * /api/time-controls:
 *   get:
 *     summary: Get supported time controls
 *     tags: [Time Controls]
 *     responses:
 *       200:
 *         description: List of available time presets
 */
router.get('/time-controls', gameController.getTimeControls);

/**
 * @openapi
 * /api/games/pending:
 *   get:
 *     summary: Get pending open games in lobby
 *     tags: [Games]
 *     responses:
 *       200:
 *         description: List of pending games awaiting opponent
 */
router.get('/games/pending', gameController.getPendingGames);

/**
 * @openapi
 * /api/games:
 *   get:
 *     summary: Query completed games history
 *     tags: [Games]
 *     parameters:
 *       - in: query
 *         name: player
 *         schema:
 *           type: string
 *         description: Filter games by player Stellar address
 *     responses:
 *       200:
 *         description: Historical game records
 */
router.get('/games', gameController.getGameHistory);

/**
 * @openapi
 * /api/games/{gameCode}/join:
 *   post:
 *     summary: Join an existing open game lobby
 *     tags: [Games]
 *     parameters:
 *       - in: path
 *         name: gameCode
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [playerAddress]
 *             properties:
 *               playerColor:
 *                 type: string
 *                 enum: [white, black]
 *               playerAddress:
 *                 type: string
 *     responses:
 *       200:
 *         description: Joined game successfully
 *       400:
 *         description: Cannot join own game or game full
 */
router.post('/games/:gameCode/join', enforceExistingGameGeoCompliance, gameController.joinGame);

/**
 * @openapi
 * /api/games/{gameCode}:
 *   get:
 *     summary: Get game state by code
 *     tags: [Games]
 *     parameters:
 *       - in: path
 *         name: gameCode
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Game state data
 *       404:
 *         description: Game not found
 */
router.get('/games/:gameCode', gameController.getGame);

/**
 * @openapi
 * /api/games/{gameCode}/move:
 *   post:
 *     summary: Submit a chess move
 *     tags: [Games]
 *     parameters:
 *       - in: path
 *         name: gameCode
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [from, to]
 *     responses:
 *       200:
 *         description: Move accepted
 *       400:
 *         description: Illegal move
 */
router.post('/games/:gameCode/move', gameController.makeMove);

/**
 * @openapi
 * /api/games/{gameCode}/moves:
 *   get:
 *     summary: Get move history for a game
 *     tags: [Games]
 *     parameters:
 *       - in: path
 *         name: gameCode
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of move records
 */
router.get('/games/:gameCode/moves', gameController.getMoves);

/**
 * @openapi
 * /api/games/{gameCode}/resign:
 *   post:
 *     summary: Resign an active game
 *     tags: [Games]
 *     parameters:
 *       - in: path
 *         name: gameCode
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Resignation processed
 */
router.post('/games/:gameCode/resign', gameController.resignGame);

/**
 * @openapi
 * /api/games/{gameCode}/draw/offer:
 *   post:
 *     summary: Offer a draw
 *     tags: [Games]
 *     parameters:
 *       - in: path
 *         name: gameCode
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Draw offer sent
 */
router.post('/games/:gameCode/draw/offer', gameController.offerDraw);

/**
 * @openapi
 * /api/games/{gameCode}/draw/accept:
 *   post:
 *     summary: Accept a pending draw offer
 *     tags: [Games]
 *     parameters:
 *       - in: path
 *         name: gameCode
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Draw accepted
 */
router.post('/games/:gameCode/draw/accept', gameController.acceptDraw);

/**
 * @openapi
 * /api/games/{gameCode}/draw/claim:
 *   post:
 *     summary: Claim a draw under the threefold repetition or 50-move rule
 *     tags: [Games]
 *     parameters:
 *       - in: path
 *         name: gameCode
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Draw claimed
 *       400:
 *         description: Draw cannot be claimed yet
 */
router.post('/games/:gameCode/draw/claim', gameController.claimDraw);

/**
 * @openapi
 * /api/games/{gameCode}/undo/request:
 *   post:
 *     summary: Request an undo move
 *     tags: [Games]
 *     parameters:
 *       - in: path
 *         name: gameCode
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Undo requested
 */
router.post('/games/:gameCode/undo/request', gameController.requestUndoMove);

/**
 * @openapi
 * /api/games/{gameCode}/undo/accept:
 *   post:
 *     summary: Accept an undo move request
 *     tags: [Games]
 *     parameters:
 *       - in: path
 *         name: gameCode
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Undo accepted
 */
router.post('/games/:gameCode/undo/accept', gameController.acceptUndoMove);

/**
 * @openapi
 * /api/games/{gameCode}/undo/reject:
 *   post:
 *     summary: Reject an undo move request
 *     tags: [Games]
 *     parameters:
 *       - in: path
 *         name: gameCode
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Undo rejected
 */
router.post('/games/:gameCode/undo/reject', gameController.rejectUndoMove);
/**
 * @openapi
 * /api/games/{gameCode}/end:
 *   post:
 *     summary: End a game match and advance tournament bracket
 *     tags: [Games]
 *     parameters:
 *       - in: path
 *         name: gameCode
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Game ended successfully
 */
router.post('/games/:gameCode/end', gameController.endGame);

/**
 * @openapi
 * /api/games/{gameCode}/chat:
 *   get:
 *     summary: Get chat messages for game
 *     tags: [Games]
 *     parameters:
 *       - in: path
 *         name: gameCode
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Array of chat messages
 */
router.get('/games/:gameCode/chat', gameController.getChatMessages);

module.exports = router;
