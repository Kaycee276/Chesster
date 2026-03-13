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
		timeControlSeconds = 600,
		gameCode = null,
	) {
		if (!gameCode) gameCode = this.generateGameCode();
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
				time_control_seconds: timeControlSeconds,
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

		const now = new Date().toISOString();
		const { data, error } = await supabase
			.from("games")
			.update({
				[updateField]: true,
				[addressField]: playerAddress,
				status: bothPlayersJoined ? "active" : "waiting",
				escrow_status: bothPlayersJoined && game.wager_amount ? "active" : game.escrow_status,
				...(bothPlayersJoined
					? { turn_started_at: now, game_started_at: now }
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

		// Auto-cancel waiting games that have been open for over 1 hour.
		if (data && data.status === "waiting") {
			const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
			if (data.created_at < oneHourAgo) {
				const { data: cancelled } = await supabase
					.from("games")
					.update({ status: "cancelled" })
					.eq("game_code", gameCode)
					.select()
					.single();
				return cancelled ?? data;
			}
		}

		// Retry escrow settlement if the game is finished but settlement never
		// completed (e.g. server restarted). The on-chain check inside
		// _settleEscrow is idempotent — if already RESOLVED it just syncs the DB.
		if (
			data &&
			data.status === "finished" &&
			data.wager_amount &&
			data.escrow_status !== "settled" &&
			data.escrow_status !== "failed" &&
			data.escrow_status !== "refunded"
		) {
			this._settleEscrow(gameCode, data, data.winner).catch((err) => {
				console.error(`[Escrow] retry _settleEscrow for ${gameCode}:`, err.message);
			});
		}

		return data;
	}

	async getPendingGames() {
		const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

		const { data, error } = await supabase
			.from("games")
			.select("game_code, created_at, wager_amount, time_control_seconds, player_white_address")
			.eq("status", "waiting")
			.order("created_at", { ascending: false })
			.limit(30);

		if (error) throw error;

		// Mark expired games as cancelled (non-blocking)
		const expired = data.filter((g) => g.created_at < oneHourAgo);
		if (expired.length > 0) {
			const codes = expired.map((g) => g.game_code);
			supabase
				.from("games")
				.update({ status: "cancelled" })
				.in("game_code", codes)
				.then(() => {
					console.log(`[GameModel] Cancelled ${codes.length} expired pending games`);
				})
				.catch(console.error);
		}

		// Return only games still within the 1-hour window
		return data.filter((g) => g.created_at >= oneHourAgo);
	}

	/**
	 * End a game when the shared timer expires.
	 * Winner = player with the most material on the board (by piece value).
	 * Piece values: Q=9, R=5, B=3, N=3, P=1. Draw if equal.
	 */
	async endByTime(gameCode) {
		const game = await this.getGame(gameCode);
		if (!game || game.status !== "active") return game;

		const PIECE_VALUE = { q: 9, r: 5, b: 3, n: 3, p: 1 };
		let whiteScore = 0;
		let blackScore = 0;

		for (const row of game.board_state) {
			for (const cell of row) {
				if (cell === "." || cell.toLowerCase() === "k") continue;
				const val = PIECE_VALUE[cell.toLowerCase()] || 0;
				if (cell === cell.toUpperCase()) whiteScore += val;
				else blackScore += val;
			}
		}

		const winner = whiteScore > blackScore ? "white" : blackScore > whiteScore ? "black" : "draw";

		const { data, error } = await supabase
			.from("games")
			.update({ status: "finished", winner, end_reason: "time" })
			.eq("game_code", gameCode)
			.select()
			.single();

		if (error) throw error;

		this._settleEscrow(gameCode, data, winner).catch((err) => {
			console.error(`[Escrow] _settleEscrow threw for ${gameCode}:`, err.message);
		});

		console.log(`[GameModel] ${gameCode} ended by time — white ${whiteScore} vs black ${blackScore} → ${winner}`);
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
				// Use the on-chain player addresses (from getMatch above) rather than
				// the DB addresses. The contract's resolveMatch checks
				// `winner == m.player1 || winner == m.player2`, so using the exact
				// addresses already stored on-chain eliminates any mismatch revert.
				// player1 = createMatch caller = white, player2 = joinMatch caller = black.
				const winnerAddress = winner === "white" ? onChain.player1 : onChain.player2;

				if (!winnerAddress || winnerAddress === "0x0000000000000000000000000000000000000000") {
					console.error(`[Escrow] ${gameCode} — no on-chain address for winner="${winner}"`);
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
		let endReason = null;

		if (kingCaptured || isCheckmate) {
			newStatus = "finished";
			winner = game.current_turn;
			endReason = "checkmate";
		} else if (isStalemate) {
			newStatus = "finished";
			winner = "draw";
			endReason = "stalemate";
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
				end_reason: endReason,
				captured_white: newCapturedWhite,
				captured_black: newCapturedBlack,
				turn_started_at: new Date().toISOString(),
				draw_offer: null,
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
			.update({ status: "finished", winner, end_reason: "resignation" })
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
		const existing = await this.getGame(gameCode);
		if (!existing) throw new Error("Game not found");
		if (existing.status !== "active") throw new Error("Game is not active");
		if (!existing.draw_offer) throw new Error("No draw offer pending");

		const { data, error } = await supabase
			.from("games")
			.update({ status: "finished", winner: "draw", draw_offer: null, end_reason: "draw_agreed" })
			.eq("game_code", gameCode)
			.select()
			.single();

		if (error) throw error;
		if (!data) throw new Error("Game could not be updated — it may have already ended");

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

	async getChatMessages(gameCode) {
		const { data, error } = await supabase
			.from("chat_messages")
			.select("id, player_color, message, created_at")
			.eq("game_code", gameCode)
			.order("created_at", { ascending: true })
			.limit(200);

		if (error) throw new Error(error.message);
		return data || [];
	}

	generateGameCode() {
		return Math.random().toString(36).substring(2, 8).toUpperCase();
	}
}

module.exports = new GameModel();
