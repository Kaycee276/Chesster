const crypto = require("crypto");
const supabase = require("../config/supabase");

function utcDateKey(date = new Date()) {
	return date.toISOString().slice(0, 10);
}

function dailyPuzzleIndex(dateKey, puzzleCount) {
	if (!Number.isInteger(puzzleCount) || puzzleCount <= 0) return -1;
	const hash = crypto.createHash("sha256").update(dateKey).digest();
	return hash.readUInt32BE(0) % puzzleCount;
}

class PuzzleModel {
  async getAdaptivePuzzle(targetRating, range = 100, excludeId) {
    let query = supabase.from("puzzles")
      .select("id, fen, side_to_move, rating, solution_moves")
      .eq("is_active", true)
      .gte("rating", targetRating - range)
      .lte("rating", targetRating + range);
    if (excludeId) query = query.neq("id", excludeId);
    const { data, error } = await query.order("id", { ascending: true });
    if (error) throw error;
    if (data?.length) return data[Math.floor(Math.random() * data.length)];
    // Sparse catalogs can have no puzzle in the requested window. Pick the
    // nearest available rating so the initial rating and later updates work.
    let fallback = supabase.from("puzzles")
      .select("id, fen, side_to_move, rating, solution_moves")
      .eq("is_active", true);
    if (excludeId) fallback = fallback.neq("id", excludeId);
    const nearest = await fallback.order("rating", { ascending: true });
    if (nearest.error) throw nearest.error;
    if (!nearest.data?.length) return null;
    return nearest.data.reduce((best, puzzle) =>
      Math.abs(puzzle.rating - targetRating) < Math.abs(best.rating - targetRating) ? puzzle : best);
  }

	async getDailyPuzzle(date = new Date()) {
		const dateKey = utcDateKey(date);
		const { count, error: countError } = await supabase
			.from("puzzles")
			.select("id", { count: "exact", head: true })
			.eq("is_active", true);

		if (countError) throw countError;
		if (!count) return null;

		const index = dailyPuzzleIndex(dateKey, count);
		const { data, error } = await supabase
			.from("puzzles")
			.select("id, fen, side_to_move, rating")
			.eq("is_active", true)
			.order("id", { ascending: true })
			.range(index, index)
			.single();

		if (error) throw error;
		return { ...data, date: dateKey };
	}

	async getById(id) {
		const { data, error } = await supabase
			.from("puzzles")
			.select("id, fen, side_to_move, rating, solution_moves")
			.eq("id", id)
			.eq("is_active", true)
			.maybeSingle();

		if (error) throw error;
		return data;
	}
}

module.exports = new PuzzleModel();
module.exports.dailyPuzzleIndex = dailyPuzzleIndex;
module.exports.utcDateKey = utcDateKey;
