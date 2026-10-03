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
