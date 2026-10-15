import { describe, it, expect } from "vitest";
import { parsePgn, replayPgn, loadPgn, splitPgnGames, PgnParseError } from "../src/utils/pgnParser";
import { squareToAlgebraic } from "../src/utils/chessUtils";

const RUY_LOPEZ = `[Event "Test"]
[White "Alice"]
[Black "Bob"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5
7. Bb3 d6 8. c3 O-O 9. h3 Nd7 1-0`;

const SCHOLARS_MATE = `1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7#`;

// Both the b1 and f3 knights attack d2 once the d-pawn steps aside,
// exercising SAN's file-disambiguation ("Nbd2" vs "Nfd2").
const KNIGHT_DISAMBIGUATION = `1. Nf3 Nf6 2. d4 d5 3. Nbd2`;
const SICILIAN = `1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3`;

describe("pgnParser", () => {
	it("parses headers and move tokens", () => {
		const { headers, sanMoves, result } = parsePgn(RUY_LOPEZ);
		expect(headers.White).toBe("Alice");
		expect(headers.Black).toBe("Bob");
		expect(result).toBe("1-0");
		expect(sanMoves[0]).toBe("e4");
		expect(sanMoves).toContain("O-O");
		expect(sanMoves).toContain("Nd7");
	});

	it("replays a full game including castling and disambiguated knight moves", () => {
		const { moves } = loadPgn(RUY_LOPEZ);
		expect(moves).toHaveLength(18);

		// 1. e4 -> pawn e2-e4
		expect(squareToAlgebraic(moves[0].from)).toBe("e2");
		expect(squareToAlgebraic(moves[0].to)).toBe("e4");

		// White castles kingside (O-O) at move 5 (ply index 8)
		const castleMove = moves.find((m) => m.san === "O-O" && m.color === "white");
		expect(castleMove).toBeDefined();
		expect(squareToAlgebraic(castleMove!.from)).toBe("e1");
		expect(squareToAlgebraic(castleMove!.to)).toBe("g1");
		expect(castleMove!.boardAfter[7][5]).toBe("R"); // rook lands on f1
		expect(castleMove!.boardAfter[7][7]).toBe("."); // vacated h1

		// Black castles kingside too
		const blackCastle = moves.find((m) => m.san === "O-O" && m.color === "black");
		expect(blackCastle).toBeDefined();
		expect(squareToAlgebraic(blackCastle!.to)).toBe("g8");

	});

	it("resolves file-disambiguated knight moves to the correct piece", () => {
		const { moves } = loadPgn(KNIGHT_DISAMBIGUATION);
		const nbd2 = moves[moves.length - 1];
		expect(nbd2.san).toBe("Nbd2");
		expect(squareToAlgebraic(nbd2.from)).toBe("b1");
		expect(squareToAlgebraic(nbd2.to)).toBe("d2");
	});

	it("flags checkmate from the SAN suffix", () => {
		const { moves } = loadPgn(SCHOLARS_MATE);
		const last = moves[moves.length - 1];
		expect(last.san).toBe("Qxf7#");
		expect(last.isCheck).toBe(true);
		expect(last.isCheckmate).toBe(true);
		expect(last.isCapture).toBe(true);
	});

	it("throws a PgnParseError for garbage move text", () => {
		expect(() => replayPgn(["z9"])).toThrow(PgnParseError);
	});

	it("throws when there are no moves at all", () => {
		expect(() => loadPgn('[Event "Empty"]\n\n*')).toThrow(PgnParseError);
	});

	it("parses the Sicilian Defense move sequence", () => {
		expect(parsePgn(SICILIAN).sanMoves).toEqual([
			"e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3",
		]);
	});

	it("replays queenside castling", () => {
		const { moves } = loadPgn(`1. d4 d5 2. Nc3 Nc6 3. Bf4 Bf5 4. Qd2 Qd7 5. O-O-O`);
		const castle = moves[moves.length - 1];
		expect(castle.san).toBe("O-O-O");
		expect(squareToAlgebraic(castle.from)).toBe("e1");
		expect(squareToAlgebraic(castle.to)).toBe("c1");
		expect(castle.boardAfter[7][3]).toBe("R");
	});

	it("replays en-passant notation and removes the captured pawn", () => {
		const { moves } = loadPgn(`1. e4 a6 2. e5 d5 3. exd6 e.p.`);
		const move = moves[moves.length - 1];
		expect(move.isCapture).toBe(true);
		expect(squareToAlgebraic(move.to)).toBe("d6");
		expect(move.boardAfter[2][3]).toBe("P");
		expect(move.boardAfter[3][3]).toBe(".");
	});

	it("preserves check suffixes and all promotion pieces", () => {
		const { sanMoves } = parsePgn("1. e8=Q+ e8=R# 2. d8=B 2... c8=N");
		expect(sanMoves).toEqual(["e8=Q+", "e8=R#", "d8=B", "c8=N"]);
	});

	it("accepts file and rank disambiguation tokens", () => {
		expect(parsePgn("1. Rad1 N5f3").sanMoves).toEqual(["Rad1", "N5f3"]);
	});

	it("removes comments, clock annotations, and numeric annotation glyphs", () => {
		const { sanMoves } = parsePgn("1. e4 {[%clk 0:09:59] opening move} e5 $1 2. Nf3");
		expect(sanMoves).toEqual(["e4", "e5", "Nf3"]);
	});

	it("parses header values containing closing brackets", () => {
		const parsed = parsePgn('[Event "League [A] Final"]\n[Site "Board [1]"]\n\n1. e4 *');
		expect(parsed.headers).toEqual({ Event: "League [A] Final", Site: "Board [1]" });
		expect(parsed.sanMoves).toEqual(["e4"]);
	});
});

describe("splitPgnGames (#318)", () => {
	it("returns a single game for a one-game file", () => {
		const games = splitPgnGames(RUY_LOPEZ);
		expect(games).toHaveLength(1);
		expect(games[0].headers.White).toBe("Alice");
		expect(games[0].headers.Black).toBe("Bob");
		expect(games[0].pgn).toContain("7. Bb3 d6");
	});

	it("returns a single game for headerless movetext", () => {
		const games = splitPgnGames(SCHOLARS_MATE);
		expect(games).toHaveLength(1);
		expect(games[0].headers).toEqual({});
		expect(games[0].pgn).toContain("Qxf7#");
	});

	it("splits a multi-game collection into separate games", () => {
		const collection = [
			'[Event "World Ch. G1"]',
			'[White "Carlsen"]',
			'[Black "Caruana"]',
			"",
			"1. e4 e5 2. Nf3 1-0",
			"",
			'[Event "World Ch. G2"]',
			'[White "Caruana"]',
			'[Black "Carlsen"]',
			"",
			"1. d4 d5 0-1",
		].join("\n");

		const games = splitPgnGames(collection);
		expect(games).toHaveLength(2);
		expect(games[0].headers.Event).toBe("World Ch. G1");
		expect(games[0].pgn).not.toContain("World Ch. G2");
		expect(games[1].headers.Event).toBe("World Ch. G2");
		expect(games[1].pgn).toContain("0-1");
	});

	it("returns an empty array for blank input", () => {
		expect(splitPgnGames("")).toEqual([]);
		expect(splitPgnGames("   \n\n  ")).toEqual([]);
	});

	it("lets a corrupt game inside a collection surface its parse error", () => {
		// The analysis page replays each selected game; a corrupt one must
		// throw PgnParseError when selected rather than silently failing.
		const games = splitPgnGames(RUY_LOPEZ);
		expect(() => loadPgn(games[0].pgn.replace("2. Nf3", "2. Ke2"))).toThrow(
			PgnParseError,
		);
	});
});
