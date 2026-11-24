jest.mock("../config/supabase", () => ({ from: jest.fn() }));
const db = require("../config/supabase");
const model = require("../models/puzzleModel");
let query;
beforeEach(() => {
  jest.clearAllMocks();
  query = {};
  for (const method of ["select", "eq", "gte", "lte", "neq"]) query[method] = jest.fn(() => query);
  query.order = jest.fn().mockResolvedValue({ data: [{ id: "one", rating: 1520 }], error: null });
  db.from.mockReturnValue(query);
});
test("filters active puzzles within the rating window and excludes the previous puzzle", async () => {
  expect(await model.getAdaptivePuzzle(1500, 100, "previous")).toMatchObject({
    id: "one",
    rating: 1520,
  });
  expect(db.from).toHaveBeenCalledWith("puzzles");
  expect(query.eq).toHaveBeenCalledWith("is_active", true);
  expect(query.gte).toHaveBeenCalledWith("rating", 1400);
  expect(query.lte).toHaveBeenCalledWith("rating", 1600);
  expect(query.neq).toHaveBeenCalledWith("id", "previous");
});
test("returns no puzzle for an empty catalog and propagates query errors", async () => {
  query.order.mockResolvedValue({ data: [], error: null });
  expect(await model.getAdaptivePuzzle(1500)).toBeNull();
  query.order.mockResolvedValueOnce({ data: null, error: new Error("query failed") });
  await expect(model.getAdaptivePuzzle(1500)).rejects.toThrow("query failed");
});
test("uses the nearest available puzzle when the rating window is empty", async () => {
  query.order.mockResolvedValueOnce({ data: [], error: null });
  query.order.mockResolvedValueOnce({
    data: [
      { id: "easy", rating: 900 },
      { id: "nearest", rating: 1300 },
      { id: "hard", rating: 2000 },
    ],
    error: null,
  });
  expect(await model.getAdaptivePuzzle(1500, 100, "previous")).toMatchObject({ id: "nearest" });
  expect(query.neq).toHaveBeenCalledTimes(2);
});
