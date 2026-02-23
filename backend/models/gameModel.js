const supabase = require("../config/supabase");
const chessEngine = require("../services/chessEngine");
const escrowService = require("../services/escrowService");

// Initialize escrow service
escrowService.init();

class GameModel {
	async createGame(
		gameType = "chess",
		wagerAmount = null,
		tokenAddress = null,
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
				token_address: tokenAddress,
				player_white_address: playerWhiteAddress,
				escrow_status: wagerAmount ? "pending" : null,
			})
			.select()
			.single();

		if (error) throw error;

		// If wager is set, create match on escrow contract
		if (wagerAmount && tokenAddress && playerWhiteAddress) {
			try {
				await escrowService.createMatch(gameCode, playerWhiteAddress, tokenAddress, wagerAmount);
			} catch (escrowErr) {
				console.error("Escrow createMatch failed:", escrowErr.message);
				// Don't fail game creation if escrow fails; log for manual review
			}
		}

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
				...(bothPlayersJoined
					? { turn_started_at: new Date().toISOString() }
					: {}),
			})
			.eq("game_code", gameCode)
			.select()
			.single();

		if (error) throw error;

		// If wagered game and both players joined, call escrow joinMatch
		if (game.wager_amount && game.token_address && bothPlayersJoined) {
			try {
				await escrowService.joinMatch(gameCode, playerAddress);
			} catch (escrowErr) {
				console.error("Escrow joinMatch failed:", escrowErr.message);
				// Log but don't fail join
			}
		}

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

		// If game finished, resolve on-chain escrow
		if (newStatus === "finished") {
			try {
				if (winner === "draw") {
					await escrowService.resolveAsDraw(gameCode);
				} else {
					// winner is 'white' or 'black', need to map to player address
					const playerField =
						winner === "white" ? "player_white" : "player_black";
					const winnerAddress =
						updatedGame[
							playerField === "player_white"
								? "player_white_address"
								: "player_black_address"
						];
					if (winnerAddress) {
						await escrowService.resolveWithWinner(gameCode, winnerAddress);
					}
				}
			} catch (escrowErr) {
				console.error("Escrow resolution failed:", escrowErr.message);
				// Log but don't fail the game update
			}
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

		// Resolve escrow with winner address
		try {
			const winnerField =
				winner === "white" ? "player_white_address" : "player_black_address";
			const winnerAddress = data[winnerField];
			if (winnerAddress) {
				await escrowService.resolveWithWinner(gameCode, winnerAddress);
			}
		} catch (escrowErr) {
			console.error("Escrow resolution failed:", escrowErr.message);
		}

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

		// Resolve escrow as draw
		try {
			await escrowService.resolveAsDraw(gameCode);
		} catch (escrowErr) {
			console.error("Escrow resolution failed:", escrowErr.message);
		}

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
