// Recognize broad opening families from the initial mainline only.
// These are not a complete ECO database; never invent a detailed ECO code.
const OPENING_PREFIX_PLIES = 6;
const FAMILIES = [
  { name: "Ruy Lopez", moves: ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5"] },
  { name: "Italian Game", moves: ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4"] },
  { name: "Scotch Game", moves: ["e2e4", "e7e5", "g1f3", "b8c6", "d2d4"] },
  { name: "Queen's Gambit", moves: ["d2d4", "d7d5", "c2c4"] },
  { name: "Sicilian Defense", moves: ["e2e4", "c7c5"] },
  { name: "French Defense", moves: ["e2e4", "e7e6"] },
  { name: "Caro-Kann Defense", moves: ["e2e4", "c7c6"] },
  { name: "English Opening", moves: ["c2c4"] },
];

function squareName(position) {
  if (!Array.isArray(position) || position.length !== 2 ||
      !position.every((coordinate) => Number.isInteger(coordinate) && coordinate >= 0 && coordinate < 8)) return null;
  return String.fromCharCode(97 + position[1]) + String(8 - position[0]);
}

function classifyOpening(moves) {
  const unknown = { openingName: null, openingEco: null };
  if (!Array.isArray(moves) || moves.length === 0) return unknown;
  const prefix = [...moves].sort((a, b) => (a?.move_number || 0) - (b?.move_number || 0))
    .slice(0, OPENING_PREFIX_PLIES);
  const uci = [];
  for (const [index, move] of prefix.entries()) {
    if (!move || move.move_number !== index + 1) return unknown;
    const from = squareName(move.from_position);
    const to = squareName(move.to_position);
    if (!from || !to) return unknown;
    uci.push(from + to);
  }
  const family = FAMILIES.find((candidate) =>
    candidate.moves.length <= uci.length && candidate.moves.every((move, index) => move === uci[index]));
  return family ? { openingName: family.name, openingEco: null } : unknown;
}

module.exports = { classifyOpening, OPENING_PREFIX_PLIES };
