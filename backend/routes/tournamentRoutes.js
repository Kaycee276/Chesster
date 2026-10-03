const express = require("express");
const router = express.Router();
const tournamentController = require("../controllers/tournamentController");
const {
	validate,
	listTournamentsSchema,
	tournamentIdSchema,
	registerPlayerSchema,
} = require("../middleware/validateTournament");

router.get(
	"/tournaments",
	validate(listTournamentsSchema, "query"),
	tournamentController.listTournaments,
);

router.get(
	"/tournaments/:id",
	validate(tournamentIdSchema, "params"),
	tournamentController.getTournamentById,
);

router.get(
	"/tournaments/:id/bracket",
	validate(tournamentIdSchema, "params"),
	tournamentController.getTournamentBracket,
);

router.post(
	"/tournaments/:id/register",
	validate(tournamentIdSchema, "params"),
	validate(registerPlayerSchema, "body"),
	tournamentController.registerPlayer,
);

module.exports = router;
