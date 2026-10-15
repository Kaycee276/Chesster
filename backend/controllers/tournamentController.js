const { Keypair } = require("@stellar/stellar-sdk");
const tournamentModel = require("../models/tournamentModel");
const tournamentService = require("../services/tournamentService");

/** Tournament statuses that still accept new registrations. */
const REGISTRATION_OPEN_STATUSES = ["open"];

/**
 * TournamentController — HTTP handlers for the tournament REST API.
 *
 * Endpoints:
 *   GET  /api/tournaments            -> listTournaments
 *   GET  /api/tournaments/:id        -> getTournamentById
 *   GET  /api/tournaments/:id/bracket-> getTournamentBracket
 *   POST /api/tournaments/:id/register -> registerPlayer
 */
class TournamentController {
	constructor() {
		for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(this))) {
			if (typeof this[key] === "function" && key !== "constructor") {
				this[key] = this[key].bind(this);
			}
		}
	}

	/** GET /api/tournaments?status=open&limit=20 */
	async listTournaments(req, res, next) {
		try {
			const { status, limit } = req.validated?.query || req.query;
			const tournaments = await tournamentModel.listTournaments({
				status,
				limit: limit ? Number(limit) : 50,
			});
			res.json({ success: true, count: tournaments.length, tournaments });
		} catch (error) {
			next(error);
		}
	}

	/** GET /api/tournaments/:id */
	async getTournamentById(req, res, next) {
		try {
			const { id } = req.validated?.params || req.params;
			const tournament = await tournamentModel.getTournamentById(id);
			if (!tournament) {
				return res.status(404).json({ success: false, error: "Tournament not found" });
			}

			const participants = await tournamentModel.getParticipants(id);

			res.json({
				success: true,
				tournament: {
					...tournament,
					participantCount: participants.length,
					participants,
				},
			});
		} catch (error) {
			next(error);
		}
	}

	/** GET /api/tournaments/:id/bracket */
	async getTournamentBracket(req, res, next) {
		try {
			const { id } = req.validated?.params || req.params;
			const tournament = await tournamentModel.getTournamentById(id);
			if (!tournament) {
				return res.status(404).json({ success: false, error: "Tournament not found" });
			}

			const bracket = await tournamentService.getBracketTree(id);
			res.json({ success: true, bracket });
		} catch (error) {
			next(error);
		}
	}

	/** POST /api/tournaments/:id/register */
	async registerPlayer(req, res, next) {
		try {
			const { id } = req.validated?.params || req.params;
			const { walletAddress, signature } = req.validated?.body || req.body;

			const tournament = await tournamentModel.getTournamentById(id);
			if (!tournament) {
				return res.status(404).json({ success: false, error: "Tournament not found" });
			}

			if (!REGISTRATION_OPEN_STATUSES.includes(tournament.status)) {
				return res.status(409).json({
					success: false,
					error: `Registration is closed for tournaments with status '${tournament.status}'`,
				});
			}

			if (!this.verifyRegistrationSignature(walletAddress, signature)) {
				return res.status(401).json({ success: false, error: "Invalid wallet signature" });
			}

			if (await tournamentModel.isParticipant(id, walletAddress)) {
				return res.status(409).json({
					success: false,
					error: "Wallet is already registered for this tournament",
				});
			}

			const participantCount = await tournamentModel.countParticipants(id);
			if (participantCount >= tournament.max_players) {
				return res.status(409).json({
					success: false,
					error: "Tournament has reached its maximum number of players",
				});
			}

			const { executeWithRetry } = require("../database/transactionRetry");
			const participant = await executeWithRetry(
				async () => tournamentModel.addParticipant(
					id,
					walletAddress,
					participantCount + 1,
				),
				{ context: `register-player-${id}-${walletAddress}` }
			);

			res.status(201).json({
				success: true,
				participant,
				participantCount: participantCount + 1,
			});
		} catch (error) {
			next(error);
		}
	}

	/** POST /api/tournaments/:id/advance */
	async advanceRound(req, res, next) {
		try {
			const { id } = req.validated?.params || req.params;
			const { completedMatchId, winnerAddress, nextRound } = req.validated?.body || req.body;
			const { executeWithRetry } = require("../database/transactionRetry");

			const result = await executeWithRetry(
				async () => {
					if (completedMatchId && winnerAddress) {
						return await tournamentService.advanceMatchWinner(id, completedMatchId, winnerAddress);
					}
					return await tournamentModel.advanceRound(id, nextRound);
				},
				{ context: `advance-round-${id}` }
			);

			res.json({ success: true, result });
		} catch (error) {
			next(error);
		}
	}

	/** PUT /api/tournaments/:id/participants/:address/score */
	async updateParticipantScore(req, res, next) {
		try {
			const { id, address } = req.validated?.params || req.params;
			const { scoreDelta, score, status } = req.validated?.body || req.body;
			const { executeWithRetry } = require("../database/transactionRetry");

			const participant = await executeWithRetry(
				async () => {
					return await tournamentModel.updateParticipantScore(id, address, { scoreDelta, score, status });
				},
				{ context: `update-participant-score-${id}-${address}` }
			);

			res.json({ success: true, participant });
		} catch (error) {
			next(error);
		}
	}

	/**
	 * Verify a base64 signature over the canonical registration message using
	 * the Stellar public key supplied as `walletAddress`.
	 */
	verifyRegistrationSignature(walletAddress, signature) {
		if (!walletAddress || !signature) return false;

		let keypair;
		try {
			keypair = Keypair.fromPublicKey(walletAddress);
		} catch {
			return false;
		}

		try {
			return keypair.verify(
				Buffer.from(this.registrationMessage(walletAddress), "utf8"),
				Buffer.from(signature, "base64"),
			);
		} catch {
			return false;
		}
	}

	/** Canonical message a player signs to register for a tournament. */
	registrationMessage(walletAddress) {
		return `Chesster tournament registration\naddress: ${walletAddress}`;
	}
}

module.exports = new TournamentController();
module.exports.REGISTRATION_OPEN_STATUSES = REGISTRATION_OPEN_STATUSES;
