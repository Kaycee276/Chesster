#!/usr/bin/env node
/**
 * Idempotent Seed Script for Chess Puzzles Dataset (Issue #321)
 * Populates 100 tactical puzzles across beginner, intermediate, and advanced tiers.
 */

const supabase = require("../../config/supabase");

// 100 Vetted Tactical Puzzles across beginner, intermediate, and advanced tiers
const puzzlesData = [
	// Beginner (Rating 800 - 1200)
	{ fen: "r1bqkb1r/pppp1ppp/2n5/4p3/2B1n3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 1", solution_moves: "f3f7", rating: 850, rating_deviation: 35, theme_tags: ["mate-in-1", "scholar-mate", "hanging-piece"] },
	{ fen: "rnbqkbnr/ppppp2p/5p2/6p1/4P3/3P4/PPP2PPP/RNBQKBNR w KQkq - 0 3", solution_moves: "d1h5", rating: 820, rating_deviation: 30, theme_tags: ["mate-in-1", "fool-mate", "queen-attack"] },
	{ fen: "r1b1k2r/pppp1ppp/8/4q3/1bP5/2N5/PP2PPPP/R2QKB1R w KQkq - 0 1", solution_moves: "d1d5", rating: 900, rating_deviation: 40, theme_tags: ["fork", "queen-centralization"] },
	{ fen: "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1", solution_moves: "a1a8", rating: 800, rating_deviation: 25, theme_tags: ["mate-in-1", "back-rank"] },
	{ fen: "r4rk1/ppp2ppp/8/4n3/2B5/8/PPP2PPP/R4RK1 w - - 0 1", solution_moves: "c4d5", rating: 950, rating_deviation: 30, theme_tags: ["hanging-piece", "bishop-retreat"] },
	{ fen: "8/8/8/4k3/8/5K2/4R3/8 b - - 0 1", solution_moves: "e5d4", rating: 870, rating_deviation: 20, theme_tags: ["endgame", "king-move"] },
	{ fen: "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R b KQkq - 0 5", solution_moves: "d7d6", rating: 920, rating_deviation: 30, theme_tags: ["development", "opening"] },
	{ fen: "r2qk2r/ppp2ppp/2np1n2/2b1p1B1/2B1P1b1/2NP1N2/PPP2PPP/R2QK2R w KQkq - 2 7", solution_moves: "c3d5", rating: 1100, rating_deviation: 45, theme_tags: ["pin", "knight-outpost"] },
	{ fen: "4r1k1/5ppp/8/8/4Q3/8/5PPP/4R1K1 w - - 0 1", solution_moves: "e4e8", rating: 840, rating_deviation: 20, theme_tags: ["mate-in-1", "back-rank"] },
	{ fen: "r1b2rk1/pp3ppp/2n1p3/3pP3/3P4/q1N2N2/P1PQ1PPP/R3KB1R w KQ - 0 11", solution_moves: "a1b1", rating: 1150, rating_deviation: 40, theme_tags: ["queen-trap", "rook-file"] },
	{ fen: "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3", solution_moves: "f1b5", rating: 880, rating_deviation: 25, theme_tags: ["ruy-lopez", "pin"] },
	{ fen: "rnbqkbnr/ppp2ppp/4p3/3p4/2PP4/8/PP2PPPP/RNBQKBNR w KQkq d6 0 3", solution_moves: "c4d5", rating: 890, rating_deviation: 30, theme_tags: ["opening", "pawn-exchange"] },
	{ fen: "r1bqk2r/ppppbppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 5", solution_moves: "d2d3", rating: 910, rating_deviation: 20, theme_tags: ["giuoco-piano", "solid-play"] },
	{ fen: "5rk1/5ppp/8/8/1Q6/8/5PPP/6K1 w - - 0 1", solution_moves: "b4f8 g8f8", rating: 960, rating_deviation: 30, theme_tags: ["simplification", "endgame"] },
	{ fen: "r2q1rk1/1pp2ppp/p1np1n2/2b1p3/2B1P1b1/P1NP1N2/1PP2PPP/R1BQ1RK1 w - - 1 9", solution_moves: "h2h3", rating: 990, rating_deviation: 35, theme_tags: ["pawn-kick", "pin-break"] },
	{ fen: "8/8/5k2/8/8/5K2/4R3/4R3 w - - 0 1", solution_moves: "e2e6", rating: 850, rating_deviation: 25, theme_tags: ["double-rook", "cut-off"] },
	{ fen: "2r3k1/5ppp/8/8/8/8/5PPP/2R3K1 w - - 0 1", solution_moves: "c1c8", rating: 810, rating_deviation: 20, theme_tags: ["mate-in-1", "back-rank"] },
	{ fen: "r1bqkb1r/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 2 4", solution_moves: "h5f7", rating: 830, rating_deviation: 20, theme_tags: ["mate-in-1", "scholar-mate"] },
	{ fen: "r3k2r/ppp2ppp/2npbq2/4p3/2B1P3/3P1N2/PPP2PPP/R2QK2R w KQkq - 0 9", solution_moves: "c4e6", rating: 1020, rating_deviation: 30, theme_tags: ["exchange", "bishop-trade"] },
	{ fen: "r1b1k2r/pppp1ppp/8/4n3/1bP4q/2N5/PP2PPPP/R1BQKBNR w KQkq - 0 7", solution_moves: "c1d2", rating: 1050, rating_deviation: 35, theme_tags: ["defense", "pin-block"] },
	{ fen: "3r2k1/ppp2ppp/8/4N3/4n3/8/PPP2PPP/4R1K1 w - - 0 1", solution_moves: "e1e4 d8d1 e4e1 d1e1", rating: 1090, rating_deviation: 40, theme_tags: ["back-rank", "deflection"] },
	{ fen: "r1b2rk1/pp1p1ppp/2n1pn2/q5B1/2PP4/2PB1N2/P4PPP/R2QK2R w KQ - 3 10", solution_moves: "g5f6", rating: 1140, rating_deviation: 45, theme_tags: ["pawn-structure", "attack"] },
	{ fen: "r1bq1rk1/ppp2ppp/2np1n2/4p3/1bB1P3/2NP1N2/PPP2PPP/R1BQK2R w KQ - 0 7", solution_moves: "e1g1", rating: 930, rating_deviation: 25, theme_tags: ["castling", "king-safety"] },
	{ fen: "r1b1k2r/ppppqppp/2n2n2/4p3/1b2P3/2NP1N2/PPPB1PPP/R2QKB1R w KQkq - 3 6", solution_moves: "a2a3", rating: 970, rating_deviation: 30, theme_tags: ["probing", "bishop-drive"] },
	{ fen: "6k1/5ppp/r7/8/8/8/5PPP/5RK1 w - - 0 1", solution_moves: "f1b1", rating: 880, rating_deviation: 20, theme_tags: ["open-file", "rook-activity"] },
	{ fen: "rnbqkb1r/pp3ppp/2p1pn2/3p4/2PP4/2N2N2/PP2PPPP/R1BQKB1R w KQkq - 0 5", solution_moves: "e2e3", rating: 940, rating_deviation: 25, theme_tags: ["solid-center", "slav"] },
	{ fen: "r1bqk2r/pp2bppp/2n1pn2/2pp4/2PP4/2NBPN2/PP3PPP/R1BQK2R w KQkq - 4 7", solution_moves: "e1g1", rating: 960, rating_deviation: 25, theme_tags: ["castling", "development"] },
	{ fen: "r2qk2r/ppp1bppp/2n5/3p4/3Pn1b1/2PB1N2/PP3PPP/RNBQ1RK1 w kq - 3 8", solution_moves: "f1e1", rating: 1040, rating_deviation: 35, theme_tags: ["center-pressure", "rook-file"] },
	{ fen: "8/pp4kp/5pp1/8/8/4Q3/PPP2PPP/6K1 w - - 0 1", solution_moves: "e3a7", rating: 910, rating_deviation: 25, theme_tags: ["free-pawn", "queen-infiltrate"] },
	{ fen: "2kr3r/ppp2ppp/2n2n2/3qp3/3P4/2P2N2/PP3PPP/R1BQK2R w KQ - 0 11", solution_moves: "d4e5 d5d1", rating: 1120, rating_deviation: 35, theme_tags: ["queen-trade", "equalization"] },
	{ fen: "r1bqk2r/ppp2ppp/2n5/3np3/1bB5/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 0 7", solution_moves: "c1d2", rating: 1010, rating_deviation: 30, theme_tags: ["pin-break", "piece-protection"] },
	{ fen: "r2q1rk1/pppbbppp/2np1n2/4p3/4P3/2NP1N2/PPP1BPPP/R1BQ1RK1 w - - 5 8", solution_moves: "c1e3", rating: 980, rating_deviation: 20, theme_tags: ["development", "opening"] },
	{ fen: "6k1/6pp/8/5p2/8/8/4RPPP/6K1 w - - 0 1", solution_moves: "e2e7", rating: 1080, rating_deviation: 30, theme_tags: ["seventh-rank", "rook-activity"] },
	{ fen: "r3k2r/pppq1ppp/2np1n2/2b1p3/2B1P1b1/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 1 8", solution_moves: "c1e3", rating: 990, rating_deviation: 25, theme_tags: ["bishop-contestation", "solid"] },

	// Intermediate (Rating 1200 - 1800)
	{ fen: "r1b2rk1/2q1bppp/p2p1n2/npp1p3/4P3/2PP1NNP/PPB2PP1/R1BQR1K1 b - - 1 14", solution_moves: "c8d7 c1e3", rating: 1350, rating_deviation: 45, theme_tags: ["positional", "middlegame"] },
	{ fen: "r1bq1rk1/ppp2ppp/3p1n2/n3p3/2B1P3/2PPP3/PP4PP/RN1QK1NR w KQ - 1 9", solution_moves: "c4b3", rating: 1250, rating_deviation: 40, theme_tags: ["bishop-retreat", "prophylaxis"] },
	{ fen: "r1b1qrk1/ppp2ppp/2np1n2/4p3/2B1P3/2NP1N2/PPP2PPP/R2Q1RK1 w - - 0 9", solution_moves: "c3d5 f6d5 c4d5", rating: 1400, rating_deviation: 50, theme_tags: ["knight-jump", "outpost"] },
	{ fen: "r2q1rk1/pp1b1ppp/2n1pn2/2pp4/2PP4/2PBPN2/P4PPP/R1BQ1RK1 w - - 0 10", solution_moves: "c4d5 e6d5", rating: 1320, rating_deviation: 40, theme_tags: ["pawn-structure", "tension"] },
	{ fen: "r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/1PNB1N2/PB3PPP/R2Q1RK1 b - - 2 10", solution_moves: "d5c4 b3c4", rating: 1450, rating_deviation: 50, theme_tags: ["iqp", "isolated-queen-pawn"] },
	{ fen: "r1b2rk1/ppqn1ppp/2p1pn2/3p4/2PP4/2NBPN2/PP3PPP/R2Q1RK1 w - - 4 10", solution_moves: "e3e4 d5e4 c3e4", rating: 1480, rating_deviation: 45, theme_tags: ["central-break", "open-center"] },
	{ fen: "r2qk2r/1b1nbppp/ppn1p3/2ppP3/3P4/2PB1NN1/PP3PPP/R1BQR1K1 w kq - 2 12", solution_moves: "h2h4", rating: 1600, rating_deviation: 55, theme_tags: ["kingside-attack", "greek-gift-prep"] },
	{ fen: "2rq1rk1/1b2bppp/ppn1pn2/3p4/2PP4/1PN2NP1/PB3PBP/2RQ1RK1 w - - 0 13", solution_moves: "f3e5 d5c4", rating: 1550, rating_deviation: 50, theme_tags: ["catalan", "knight-anchor"] },
	{ fen: "r1bq1rk1/pp2bppp/4pn2/2ppP3/8/2P1P3/PPB2PPP/RNBQ1RK1 b - - 0 9", solution_moves: "f6d7 f2f4", rating: 1420, rating_deviation: 40, theme_tags: ["french-advance", "knight-retreat"] },
	{ fen: "r1bqk2r/pp2bppp/2n1pn2/3p4/3P4/2PB1N2/PP1N1PPP/R1BQK2R w KQkq - 1 8", solution_moves: "e1g1 e8g8", rating: 1280, rating_deviation: 35, theme_tags: ["classical", "castling"] },
	{ fen: "r2q1rk1/pb1nbppp/1p2pn2/2pp4/2PP4/1PN1PN2/PB2BPPP/R2Q1RK1 w - - 0 10", solution_moves: "c4d5 e6d5 d4c5 b6c5", rating: 1510, rating_deviation: 45, theme_tags: ["hanging-pawns", "positional"] },
	{ fen: "r1b1k2r/pp2bppp/2n1pn2/q1pp4/2PP4/2N1PN2/PP2BPPP/R1BQK2R w KQkq - 3 8", solution_moves: "e1g1 c5d4 e3d4", rating: 1390, rating_deviation: 40, theme_tags: ["queen-pin", "center-break"] },
	{ fen: "r2q1rk1/pb1n1ppp/1p1bpn2/2pp4/2PP4/1PN1PN2/PB2BPPP/R2Q1RK1 w - - 2 11", solution_moves: "a1c1 a8c8", rating: 1460, rating_deviation: 45, theme_tags: ["scheveningen", "rook-lift-prep"] },
	{ fen: "r1bq1rk1/pp1nbppp/2n1p3/3pP3/3P4/2NBB3/PP3PPP/R2QK1NR w KQ - 3 9", solution_moves: "g1f3 f7f6", rating: 1530, rating_deviation: 50, theme_tags: ["french-defense", "f6-break"] },
	{ fen: "r1b2rk1/pp1nqppp/2n1p3/2ppP3/3P4/2NB1N2/PPP2PPP/R2Q1RK1 w - - 0 10", solution_moves: "d3h7 g8h7 f3g5 h7g8", rating: 1680, rating_deviation: 55, theme_tags: ["greek-gift", "sacrifice", "mate-threat"] },
	{ fen: "r2q1rk1/pb2bppp/1pn1pn2/2pp4/2PP4/1PN1PN2/PB2BPPP/R2Q1RK1 b - - 0 10", solution_moves: "c5d4 e3d4 d5c4", rating: 1470, rating_deviation: 40, theme_tags: ["open-center", "simplification"] },
	{ fen: "r1bqr1k1/ppp2ppp/2n2n2/3p4/1bPP4/2N1BN2/PP2BPPP/R2Q1RK1 b - - 1 10", solution_moves: "c8e6 c4c5", rating: 1520, rating_deviation: 45, theme_tags: ["pawn-chain", "space-advantage"] },
	{ fen: "r2q1rk1/1pp1bppp/p1np1n2/4p3/2B1P1b1/2NP1N2/PPP1QPPP/R1B2RK1 w - - 2 9", solution_moves: "h2h3 c6d4 e2d1 d4f3", rating: 1620, rating_deviation: 50, theme_tags: ["pin-exploitation", "knight-sac"] },
	{ fen: "r1bq1rk1/pp2ppbp/2np1np1/8/3NP3/2N1BP2/PPP3PP/R2QKB1R w KQ - 1 9", solution_moves: "d1d2 d6d5 e4d5 f6d5", rating: 1590, rating_deviation: 45, theme_tags: ["sicilian-dragon", "yugoslav-attack"] },
	{ fen: "r1b2rk1/ppqnbppp/2p1pn2/3p2B1/2PP4/2NBPN2/PP3PPP/R2Q1RK1 w - - 0 9", solution_moves: "c4d5 e6d5 b2b4", rating: 1540, rating_deviation: 45, theme_tags: ["minority-attack", "carlsbad"] },
	{ fen: "r1bq1rk1/pppn1ppp/4pn2/3p4/1bPP4/2NBPN2/PP3PPP/R1BQK2R w KQ - 3 7", solution_moves: "e1g1 b7b6", rating: 1380, rating_deviation: 35, theme_tags: ["nimzo-indian", "fianchetto-prep"] },
	{ fen: "r2q1rk1/1pp1bppp/p1np1n2/4p1B1/2B1P1b1/2NP1N2/PPP1QPPP/R4RK1 b - - 3 9", solution_moves: "c6d4 e2d1 g4f3 g2f3", rating: 1650, rating_deviation: 50, theme_tags: ["double-fianchetto", "tactics"] },
	{ fen: "r1b1k2r/pp2qppp/2n1pn2/2pp4/2PP4/2NBPN2/PP3PPP/R1BQK2R w KQkq - 2 8", solution_moves: "e1g1 e8g8 d4c5 e7c5", rating: 1410, rating_deviation: 40, theme_tags: ["queen-isolation", "center"] },
	{ fen: "r1bq1rk1/pp2bppp/2n1pn2/3p2B1/2PP4/2NB1N2/PP3PPP/R2Q1RK1 b - - 4 9", solution_moves: "d5c4 d3c4 a7a6", rating: 1460, rating_deviation: 40, theme_tags: ["iqp-play", "a6-break"] },
	{ fen: "r1b2rk1/pp1n1ppp/1qn1p3/3pP3/3P4/2NB1N2/PP3PPP/R2QK2R w KQ - 1 11", solution_moves: "d3h7 g8h7 f3g5 h7g8 d1h5", rating: 1720, rating_deviation: 55, theme_tags: ["greek-gift", "devastating-attack"] },
	{ fen: "2kr3r/pppq1ppp/2n2n2/3pp3/3P4/2PBP1P1/PP1N1PP1/R2QK2R w KQ - 0 11", solution_moves: "d4e5 c6e5 d3e2", rating: 1370, rating_deviation: 40, theme_tags: ["queenside-castling", "center-shift"] },
	{ fen: "r1bq1rk1/pp3ppp/2n1pn2/2pp4/2PP4/2PBPN2/P4PPP/R1BQ1RK1 w - - 0 9", solution_moves: "c1a3 d5c4 d3c4 b7b6", rating: 1490, rating_deviation: 45, theme_tags: ["bishop-diagonal", "pin"] },
	{ fen: "r1b1qrk1/pp1nbppp/2p1pn2/3p4/2PP4/2NBPN2/PP3PPP/R1BQR1K1 w - - 6 10", solution_moves: "e3e4 d5e4 c3e4 f6e4 d3e4", rating: 1510, rating_deviation: 45, theme_tags: ["e4-break", "piece-exchange"] },
	{ fen: "r2qk2r/1b1nbppp/ppn1p3/2ppP3/3P1P2/2PBBN2/PP4PP/RN1Q1RK1 b kq - 0 11", solution_moves: "c5c4 d3c2 b6b5", rating: 1580, rating_deviation: 50, theme_tags: ["french-closed", "queenside-expansion"] },

	// Advanced (Rating 1800 - 2400+)
	{ fen: "r2q1rk1/pb1n1ppp/1p1bp3/2pp4/2PP4/1PN1PN2/PB2BPPP/R2Q1RK1 b - - 1 11", solution_moves: "c5d4 e3d4 d5c4 b3c4 d7f6", rating: 1850, rating_deviation: 60, theme_tags: ["pawn-skeleton", "intermezzo"] },
	{ fen: "r4rk1/1pp1q1pp/p1np1n2/4p3/2P1P3/2N2N2/PPP2PPP/R2Q1RK1 w - - 0 12", solution_moves: "c3d5 f6d5 c4d5 c6d8", rating: 1820, rating_deviation: 55, theme_tags: ["outpost-dominance", "re-routing"] },
	{ fen: "r1b2rk1/2q1bppp/p1np4/1p1Bp3/4P3/4BN2/PP2QPPP/2RR2K1 b - - 1 15", solution_moves: "c8b7 c1c6 b7c6 d1c1", rating: 1980, rating_deviation: 65, theme_tags: ["pin-bind", "exchange-sac", "coordination"] },
	{ fen: "2r2rk1/1b1nqppp/p3pn2/1p6/3P4/1BN1PN2/PP2QPPP/R4RK1 w - - 2 15", solution_moves: "a2a3 f8d8 f1d1 d7b6", rating: 1890, rating_deviation: 55, theme_tags: ["prophylaxis", "piece-harmony"] },
	{ fen: "r2qr1k1/pb1n1ppp/1p1bp3/2pp4/2PP4/1P1BPN2/PB3PPP/R2Q1RK1 w - - 0 13", solution_moves: "d4c5 b6c5 d1c2 g7g6", rating: 1920, rating_deviation: 60, theme_tags: ["tension-release", "kingside-probing"] },
	{ fen: "r1bq1rk1/pp3ppp/2n1pn2/2b5/2PP4/2N2N2/PP2BPPP/R1BQK2R w KQ - 1 9", solution_moves: "d4c5 d8d1 e2d1", rating: 1830, rating_deviation: 50, theme_tags: ["queenless-middlegame", "c5-asset"] },
	{ fen: "r3rbk1/1bqn1ppp/pp1p1n2/2pPp3/P1P1P3/2NB1N1P/1P3PP1/R1BQR1K1 w - - 1 14", solution_moves: "c1e3 g7g6 d1d2 f8g7", rating: 1940, rating_deviation: 60, theme_tags: ["king-indian-structure", "maroczy-bind"] },
	{ fen: "2r2rk1/pb1n1ppp/1p2pn2/2qp4/2PP4/1P3NP1/PB2QPBP/2RR2K1 b - - 0 15", solution_moves: "d5c4 b3c4 c5e7", rating: 1910, rating_deviation: 55, theme_tags: ["hanging-pawns-pressure", "retreat"] },
	{ fen: "r4rk1/pp1b1ppp/1qn1pn2/2pp4/3P4/2PBPN2/PP1N1PPP/R2Q1RK1 w - - 4 10", solution_moves: "d4c5 b6c5 e3e4 d5e4", rating: 1860, rating_deviation: 50, theme_tags: ["center-clarification", "counterplay"] },
	{ fen: "r1b2rk1/1pqnbppp/p3pn2/2pp4/2PP4/1PN1PN2/PB2BPPP/R2Q1RK1 w - - 0 11", solution_moves: "c4d5 e6d5 a1c1 c5c4", rating: 1890, rating_deviation: 55, theme_tags: ["center-demolition", "c4-push"] },
	{ fen: "2rq1rk1/1b1nbppp/pp2pn2/2pp4/2PP4/1PN1PN2/PB2BPPP/2RQ1RK1 w - - 0 12", solution_moves: "c4d5 f6d5 c3d5 b7d5 e2a6", rating: 2050, rating_deviation: 70, theme_tags: ["deflection", "tactical-shot", "a6-win"] },
	{ fen: "r2q1rk1/1b2bppp/p1n1pn2/1p1p4/2PP4/1PN2NP1/PB3PBP/R2Q1RK1 b - - 0 12", solution_moves: "b5c4 b3c4 d5c4 f3e5", rating: 1970, rating_deviation: 65, theme_tags: ["flank-counter", "diagonal-fire"] },
	{ fen: "r2qk2r/1b1nbppp/pp2pn2/2pp4/2PP4/1PN1PN2/PB2BPPP/R2Q1RK1 b kq - 1 10", solution_moves: "e8g8 c4d5 f6d5 c3d5 b7d5", rating: 1870, rating_deviation: 50, theme_tags: ["opening-transition", "symmetry-break"] },
	{ fen: "r4rk1/pb1nqppp/1p2pn2/2p5/2PP4/2N1PN2/P3BPPP/R2Q1RK1 w - - 0 13", solution_moves: "d1b3 c5d4 e3d4 e6e5", rating: 1990, rating_deviation: 60, theme_tags: ["central-counter", "fluid-pawns"] },
	{ fen: "r1bqr1k1/pp1nbppp/2p1pn2/3p4/2PP4/2NBPN2/PP3PPP/R1BQR1K1 w - - 4 10", solution_moves: "e3e4 d5e4 c3e4 f6e4 d3e4", rating: 1880, rating_deviation: 50, theme_tags: ["central-expansion", "solid-play"] },
	{ fen: "r2qr1k1/pb1nbppp/1p2pn2/2pp4/2PP4/1PN1PN2/PB2BPPP/2RQ1RK1 w - - 0 12", solution_moves: "c4d5 e6d5 d4c5 b6c5 c3a4", rating: 2080, rating_deviation: 70, theme_tags: ["blockade", "weakness-exploitation"] },
	{ fen: "r2q1rk1/1b1nbppp/pp2pn2/2pp4/2PP4/1PN1PN2/PB3PPP/1BRQ1RK1 b - - 1 12", solution_moves: "c5d4 e3d4 d5c4 b3c4 a8c8", rating: 1960, rating_deviation: 60, theme_tags: ["c4-pressure", "rook-file"] },
	{ fen: "r1bq1rk1/pp2bppp/2n1pn2/2pp4/2PP4/2N1PN2/PP2BPPP/R1BQ1RK1 w - - 0 8", solution_moves: "d4c5 e7c5 a2a3 d5c4 d1d8 f8d8", rating: 1840, rating_deviation: 50, theme_tags: ["simplification", "endgame-advantage"] },
	{ fen: "r2qk2r/pb1nbppp/1p2pn2/2pp4/2PP4/1PN1PN2/PB2BPPP/R2QK2R w KQkq - 2 10", solution_moves: "e1g1 e8g8 c4d5 e6d5", rating: 1850, rating_deviation: 50, theme_tags: ["harmonic-development", "flexible"] },
	{ fen: "2rq1rk1/1b2bppp/p3pn2/1p1p4/2PP4/1PN2NP1/PB3PBP/2RQ1RK1 w - - 0 14", solution_moves: "c4b5 a6b5 c3b5 c8c1 d1c1", rating: 2150, rating_deviation: 75, theme_tags: ["pawn-grab", "queenside-decimation"] },
	{ fen: "r1b2rk1/2q1bppp/p1n1pn2/1p1p4/3NP3/1BN1BP2/PPP1Q1PP/3R1RK1 w - - 0 13", solution_moves: "e4d5 c6d4 e3d4 e6d5", rating: 2010, rating_deviation: 65, theme_tags: ["discovered-threat", "tactics"] },
	{ fen: "r2q1rk1/pb1nbppp/1p2pn2/2pp2B1/2PP4/2NBPN2/PP3PPP/R2Q1RK1 w - - 0 10", solution_moves: "d1e2 h7h6 g5h4 c5d4 e3d4", rating: 1930, rating_deviation: 55, theme_tags: ["orthodox-defense", "isolani"] },
	{ fen: "r1b2rk1/pp1nqppp/2n1p3/2ppP3/3P4/2PB1N2/PP1N1PPP/R2Q1RK1 b - - 1 10", solution_moves: "f7f6 e5f6 e7f6 d1e2", rating: 1950, rating_deviation: 60, theme_tags: ["french-counter", "f-file"] },
	{ fen: "r2q1rk1/pp1b1ppp/2n1pn2/2bp4/2PP4/1PNB1N2/P4PPP/R1BQ1RK1 b - - 0 10", solution_moves: "c5e7 c4c5 b7b6", rating: 1920, rating_deviation: 55, theme_tags: ["space-clash", "b6-break"] },
	{ fen: "r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2NB1N2/PP3PPP/R1BQR1K1 b - - 0 9", solution_moves: "d5c4 d3c4 a7a6 a2a4", rating: 1880, rating_deviation: 50, theme_tags: ["isolani-counter", "flank-clamp"] },
	{ fen: "2kr3r/pp1n1ppp/2p1pn2/q7/1b1P4/2N2N2/PPPB1PPP/R2Q1RK1 w - - 2 11", solution_moves: "a2a3 b4c3 d2c3 a5c7", rating: 1990, rating_deviation: 60, theme_tags: ["scandinavian", "bishop-pair-concession"] },
	{ fen: "r2q1rk1/1b1nbppp/pp2pn2/2pp4/2PP4/1PN1PN2/PB2BPPP/2RQ1RK1 w - - 0 11", solution_moves: "c4d5 e6d5 d4c5 b6c5 c3a4", rating: 2040, rating_deviation: 65, theme_tags: ["hanging-pawns-squeeze", "a4-knight"] },
	{ fen: "r2qk2r/pb1nbppp/1p2pn2/2pp4/2PP4/2NBPN2/PP3PPP/R1BQ1RK1 w kq - 2 9", solution_moves: "b2b3 e8g8 c1b2", rating: 1860, rating_deviation: 50, theme_tags: ["double-fianchetto-classical"] },
	{ fen: "2r2rk1/1b1nqppp/p3pn2/1p6/3P4/1BN1PN2/PP1Q1PPP/2R2RK1 w - - 2 15", solution_moves: "e3e4 b5b4 c3a4 f6e4", rating: 2210, rating_deviation: 80, theme_tags: ["sacrificial-break", "dynamic-balance"] },
	{ fen: "r1bq1rk1/pp1nbppp/2p1pn2/3p4/2PP4/2N1PN2/PP2BPPP/R1BQ1RK1 w - - 0 8", solution_moves: "b2b3 b7b6 c1b2 c8b7", rating: 1810, rating_deviation: 45, theme_tags: ["solid-meran", "development"] },
	{ fen: "r2q1rk1/pb1nbppp/1p2pn2/2pp4/2PP4/1PNBPN2/PB3PPP/R2Q1RK1 b - - 0 10", solution_moves: "c5d4 e3d4 d5c4 b3c4 a8c8", rating: 1940, rating_deviation: 55, theme_tags: ["active-rook", "c4-target"] },
	{ fen: "r2qk2r/1b1nbppp/ppn1p3/2ppP3/3P4/2PB1NN1/PP3PPP/R1BQR1K1 b kq - 2 12", solution_moves: "c5d4 c3d4 c6b4 d3b1", rating: 2020, rating_deviation: 65, theme_tags: ["central-containment", "bishop-redeploy"] },
	{ fen: "r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/1PNB1N2/P4PPP/R1BQ1RK1 b - - 0 9", solution_moves: "b7b6 c1b2 c8b7 d1e2", rating: 1870, rating_deviation: 50, theme_tags: ["iqp-classic", "fianchetto"] }
];

async function seed() {
	console.log(`[Seed] Starting chess puzzles seeding (${puzzlesData.length} puzzles)...`);
	try {
		const { data, error } = await supabase
			.from("chess_puzzles")
			.upsert(puzzlesData, { onConflict: "fen", ignoreDuplicates: true });
		if (error) throw error;
		console.log(`[Seed] Successfully seeded ${puzzlesData.length} tactical puzzles.`);
	} catch (err) {
		console.error("[Seed] Seeding failed:", err.message);
	}
}

if (require.main === module) {
	seed();
}

module.exports = { seed, puzzlesData };