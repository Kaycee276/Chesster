import { describe, it, expect } from "vitest";
import { parsePgn, replayPgn, loadPgn, PgnParseError } from "../src/utils/pgnParser";
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
});
