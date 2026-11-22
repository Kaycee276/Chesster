const { classifyOpening, OPENING_PREFIX_PLIES } = require("../services/openingClassification");

const square = (name) => [8 - Number(name[1]), name.charCodeAt(0) - 97];
const moves = (...uci) => uci.map((move, index) => ({
  move_number: index + 1, from_position: square(move.slice(0, 2)), to_position: square(move.slice(2, 4)),
}));

describe("conservative profile opening classification", () => {
  test.each([
    [["e2e4", "c7c5"], "Sicilian Defense"],
    [["e2e4", "e7e6"], "French Defense"],
    [["e2e4", "c7c6"], "Caro-Kann Defense"],
    [["d2d4", "d7d5", "c2c4"], "Queen's Gambit"],
    [["e2e4", "e7e5", "g1f3", "b8c6", "f1b5"], "Ruy Lopez"],
    [["e2e4", "e7e5", "g1f3", "b8c6", "f1c4"], "Italian Game"],
  ])("recognizes %s as the broad family %s without inventing a detailed ECO", (sequence, name) => {
    expect(classifyOpening(moves(...sequence))).toEqual({ openingName: name, openingEco: null });
  });

  test("uses only a contiguous initial prefix and preserves inputs", () => {
    const input = Object.freeze(moves("e2e4", "c7c5").reverse().map(Object.freeze));
    expect(classifyOpening(input).openingName).toBe("Sicilian Defense");
    expect(input[0].move_number).toBe(2);
    expect(OPENING_PREFIX_PLIES).toBe(6);
    expect(classifyOpening([{ ...moves("e2e4")[0], move_number: 2 }]).openingName).toBeNull();
    expect(classifyOpening([{ ...moves("e2e4")[0], from_position: [-1, 4] }]).openingName).toBeNull();
    expect(classifyOpening(null).openingName).toBeNull();
    expect(classifyOpening(moves("a2a3", "a7a6")).openingName).toBeNull();
  });
});
