const supabase = require("../config/supabase");
const chessEngine = require("../services/chessEngine");
const escrowService = require("../services/escrowService");

// Initialize escrow service
escrowService.init();

// On-chain MatchStatus enum values
const ON_CHAIN_STATUS = { PENDING: 0, ACTIVE: 1, RESOLVED: 2, REFUNDED: 3 };

class GameModel {
	async createGame(
		gameType = "chess",
		wagerAmount = null,
		playerWhiteAddress = null,
	) {
		const gameCode = this.generateGameCode();
		const initialBoard = chessEngine.initBoard();

		const { data, error } = await supabase
			.from("games")
			.insert({
				game_code: gameCode,
				game_type: gameType,
				board_state: initialBoard,
				current_turn: "white",
				status: "waiting",
				wager_amount: wagerAmount,
				player_white_address: playerWhiteAddress,
				escrow_status: wagerAmount ? "pending" : null,
			})
			.select()
			.single();

		if (error) throw error;
		return data;
	}

	async joinGame(gameCode, playerColor, playerAddress = null) {
		const { data: game, error: fetchError } = await supabase
			.from("games")
			.select("*")
			.eq("game_code", gameCode)
			.single();

		if (fetchError) throw fetchError;
		if (!game) throw new Error("Game not found");
		if (game.status !== "waiting" && game.status !== "active")
			throw new Error("Cannot join game");

		// Prevent the same wallet from joining as both players
		if (playerAddress) {
			const otherColorAddress =
				playerColor === "white"
					? game.player_black_address
					: game.player_white_address;
			if (otherColorAddress === playerAddress) {
				throw new Error("You cannot play against yourself");
			}
		}

		if (game.player_white === true && game.player_black === true)
			if (
				game[playerColor === "white" ? "player_white" : "player_black"] === true
			)
				throw new Error("Player color already taken");

		const updateField =
			playerColor === "white" ? "player_white" : "player_black";
		const addressField =
			playerColor === "white" ? "player_white_address" : "player_black_address";
		const otherField =
			playerColor === "white" ? "player_black" : "player_white";
		const bothPlayersJoined = game[otherField] === true;

		const { data, error } = await supabase
			.from("games")
			.update({
				[updateField]: true,
				[addressField]: playerAddress,
				status: bothPlayersJoined ? "active" : "waiting",
				escrow_status: bothPlayersJoined && game.wager_amount ? "active" : game.escrow_status,
				...(bothPlayersJoined
					? { turn_started_at: new Date().toISOString() }
					: {}),
			})
			.eq("game_code", gameCode)
			.select()
			.single();

		if (error) throw error;
		return data;
	}

	async getGame(gameCode) {
		const { data, error } = await supabase
			.from("games")
			.select("*")
			.eq("game_code", gameCode)
			.single();

		if (error) throw error;
		return data;
	}

	/**
	 * Resolve on-chain escrow for a finished game.
	 * Players deposit ETH directly via the frontend, so we only need to call
	 * resolveMatch (coordinator role). Checks on-chain state first.
	 *
	 * @param {string} gameCode - human-readable game code
	 * @param {object} dbGame   - full game row from DB (needs player addresses)
	 * @param {string} winner   - "white" | "black" | "draw"
	 */
	async _settleEscrow(gameCode, dbGame, winner) {
		if (!dbGame.wager_amount) return; // free game, no escrow

		// ── 1. Fetch on-chain match state ────────────────────────────────────
		let onChain;
		try {
			onChain = await escrowService.getMatch(gameCode);
		} catch (err) {
			console.error(`[Escrow] getMatch failed for ${gameCode}:`, err.message);
			await supabase.from("games").update({ escrow_status: "failed" }).eq("game_code", gameCode);
			return;
		}

		const chainStatus = onChain.status; // 0=PENDING 1=ACTIVE 2=RESOLVED 3=REFUNDED

		// ── 2. Already resolved / refunded ───────────────────────────────────
		if (chainStatus === ON_CHAIN_STATUS.RESOLVED) {
			await supabase.from("games").update({ escrow_status: "settled" }).eq("game_code", gameCode);
			console.log(`[Escrow] ${gameCode} already RESOLVED on-chain — DB updated`);
			return;
		}
		if (chainStatus === ON_CHAIN_STATUS.REFUNDED) {
			await supabase.from("games").update({ escrow_status: "refunded" }).eq("game_code", gameCode);
			console.log(`[Escrow] ${gameCode} already REFUNDED on-chain — DB updated`);
			return;
		}

		// ── 3. Match not found on-chain ───────────────────────────────────────
		if (onChain.createdAt === 0) {
			console.error(`[Escrow] ${gameCode} not found on-chain — player may not have deposited`);
			await supabase.from("games").update({ escrow_status: "failed" }).eq("game_code", gameCode);
			return;
		}

		// ── 4. Match is PENDING (player2 never deposited) — can't resolve ────
		if (chainStatus === ON_CHAIN_STATUS.PENDING) {
			console.error(`[Escrow] ${gameCode} is PENDING on-chain — player2 never deposited ETH`);
			await supabase.from("games").update({ escrow_status: "failed" }).eq("game_code", gameCode);
			return;
		}

		// ── 5. Match is ACTIVE — resolve it ──────────────────────────────────
		try {
			let receipt;
			if (winner === "draw") {
				receipt = await escrowService.resolveAsDraw(gameCode);
			} else {
				const winnerAddress = winner === "white"
					? dbGame.player_white_address
					: dbGame.player_black_address;

				if (!winnerAddress) {
					console.error(`[Escrow] ${gameCode} — no address found for winner="${winner}"`);
					await supabase.from("games").update({ escrow_status: "failed" }).eq("game_code", gameCode);
					return;
				}

				receipt = await escrowService.resolveWithWinner(gameCode, winnerAddress);
			}

			await supabase
				.from("games")
				.update({ escrow_resolve_tx: receipt.hash, escrow_status: "settled" })
				.eq("game_code", gameCode);

			console.log(`[Escrow] ${gameCode} settled — tx: ${receipt.hash}`);
		} catch (resolveErr) {
			console.error(`[Escrow] resolveMatch FAILED for ${gameCode}:`, resolveErr.message);
			await supabase.from("games").update({ escrow_status: "failed" }).eq("game_code", gameCode);
		}
	}

	async makeMove(gameCode, from, to, promotion = null) {
		const game = await this.getGame(gameCode);

		if (game.status !== "active") throw new Error("Game not active");

		const validation = chessEngine.isValidMove(
			game.board_state,
			from,
			to,
			game.current_turn,
			game.last_move,
		);
		if (!validation.valid) throw new Error(validation.reason || "Invalid move");

		const piece = game.board_state[from[0]][from[1]];
		const isPromotion =
			piece.toLowerCase() === "p" && (to[0] === 0 || to[0] === 7);

		if (isPromotion && !promotion) {
			throw new Error("Promotion piece required");
		}

		const newBoard = chessEngine.makeMove(
			game.board_state,
			from,
			to,
			promotion,
			validation.enPassant,
		);
		const nextTurn = game.current_turn === "white" ? "black" : "white";

		// Track captured pieces
		const newCapturedWhite = [...(game.captured_white || [])];
		const newCapturedBlack = [...(game.captured_black || [])];

		const targetPiece = game.board_state[to[0]][to[1]];
		if (targetPiece !== ".") {
			// uppercase = white piece captured by black; lowercase = black piece captured by white
			if (targetPiece === targetPiece.toUpperCase()) {
				newCapturedWhite.push(targetPiece);
			} else {
				newCapturedBlack.push(targetPiece);
			}
		}

		// Handle en passant: the captured pawn is on the same row as the attacker
		if (validation.enPassant) {
			const epRow = game.current_turn === "white" ? to[0] + 1 : to[0] - 1;
			const epPiece = game.board_state[epRow][to[1]];
			if (epPiece !== ".") {
				if (epPiece === epPiece.toUpperCase()) {
					newCapturedWhite.push(epPiece);
				} else {
					newCapturedBlack.push(epPiece);
				}
			}
		}
		// Check if the opponent's king was directly captured
		const opponentKing = nextTurn === "white" ? "K" : "k";
		const kingCaptured = !newBoard.some((row) => row.includes(opponentKing));

		const isCheck = kingCaptured ? false : chessEngine.isKingInCheck(newBoard, nextTurn);
		const isCheckmate = kingCaptured ? false : chessEngine.isCheckmate(newBoard, nextTurn, {
			from,
			to,
			piece,
		});
		const isStalemate = kingCaptured ? false : chessEngine.isStalemate(newBoard, nextTurn, {
			from,
			to,
			piece,
		});

		let newStatus = game.status;
		let winner = null;

		if (kingCaptured || isCheckmate) {
			newStatus = "finished";
			winner = game.current_turn;
		} else if (isStalemate) {
			newStatus = "finished";
			winner = "draw";
		}

		const { data: updatedGame, error: updateError } = await supabase
			.from("games")
			.update({
				board_state: newBoard,
				current_turn: nextTurn,
				last_move: { from, to, piece },
				in_check: isCheck,
				status: newStatus,
				winner: winner,
				captured_white: newCapturedWhite,
				captured_black: newCapturedBlack,
				turn_started_at: new Date().toISOString(),
			})
			.eq("game_code", gameCode)
			.select()
			.single();

		if (updateError) throw updateError;

		// If game finished, resolve on-chain escrow (non-blocking — don't fail the move)
		if (newStatus === "finished") {
			this._settleEscrow(gameCode, updatedGame, winner).catch((err) => {
				console.error(`[Escrow] _settleEscrow threw for ${gameCode}:`, err.message);
			});
		}

		const { error: moveError } = await supabase.from("moves").insert({
			game_id: game.id,
			move_number: game.move_count + 1,
			player: game.current_turn,
			from_position: from,
			to_position: to,
			piece: piece,
			board_state_after: newBoard,
			is_check: isCheck,
			is_checkmate: isCheckmate,
			promotion: promotion,
		});

		if (moveError) throw moveError;

		await supabase
			.from("games")
			.update({ move_count: game.move_count + 1 })
			.eq("game_code", gameCode);

		return updatedGame;
	}

	async resignGame(gameCode, playerColor) {
		const winner = playerColor === "white" ? "black" : "white";
		const { data, error } = await supabase
			.from("games")
			.update({ status: "finished", winner })
			.eq("game_code", gameCode)
			.select()
			.single();

		if (error) throw error;

		this._settleEscrow(gameCode, data, winner).catch((err) => {
			console.error(`[Escrow] _settleEscrow threw for ${gameCode}:`, err.message);
		});

		return data;
	}

	async offerDraw(gameCode, playerColor) {
		const { data, error } = await supabase
			.from("games")
			.update({ draw_offer: playerColor })
			.eq("game_code", gameCode)
			.select()
			.single();

		if (error) throw error;
		return data;
	}

	async acceptDraw(gameCode) {
		const { data, error } = await supabase
			.from("games")
			.update({ status: "finished", winner: "draw", draw_offer: null })
			.eq("game_code", gameCode)
			.select()
			.single();

		if (error) throw error;

		this._settleEscrow(gameCode, data, "draw").catch((err) => {
			console.error(`[Escrow] _settleEscrow threw for ${gameCode}:`, err.message);
		});

		return data;
	}

	async forfeitTurn(gameCode) {
		const game = await this.getGame(gameCode);
		if (!game || game.status !== "active") return game;

		const nextTurn = game.current_turn === "white" ? "black" : "white";
		const { data, error } = await supabase
			.from("games")
			.update({
				current_turn: nextTurn,
				turn_started_at: new Date().toISOString(),
			})
			.eq("game_code", gameCode)
			.select()
			.single();

		if (error) throw error;
		return data;
	}

	async getMoves(gameCode) {
		const game = await this.getGame(gameCode);

		const { data, error } = await supabase
			.from("moves")
			.select("*")
			.eq("game_id", game.id)
			.order("move_number", { ascending: true });

		if (error) throw error;
		return data;
	}

	generateGameCode() {
		return Math.random().toString(36).substring(2, 8).toUpperCase();
	}
}

module.exports = new GameModel();
