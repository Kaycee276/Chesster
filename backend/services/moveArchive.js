const zlib = require("node:zlib");
const { isDeepStrictEqual } = require("node:util");
const { generateGamePGN, parsePgnStream, getSevenTagRoster } = require("./pgnService");

const MAX_MOVE_ROWS = 4096;
const MAX_ARCHIVE_BYTES = 8 * 1024 * 1024;
const MAX_PGN_BYTES = 512 * 1024;

function completeMoveSequence(game, moves) {
  return Number.isInteger(game.move_count) && game.move_count > 0 &&
    game.move_count <= MAX_MOVE_ROWS && Array.isArray(moves) &&
    moves.length === game.move_count && moves.every((move, index) =>
      move && move.game_id === game.id && move.move_number === index + 1 &&
      move.player === (index % 2 === 0 ? "white" : "black"));
}

/** Reject incomplete/invalid histories instead of making retention destructive. */
async function prepareMoveArchive(game, moves) {
  if (!completeMoveSequence(game, moves) ||
      !isDeepStrictEqual(moves.at(-1).board_state_after, game.board_state)) return null;
  const pgn = game.pgn || generateGamePGN(game, moves);
  if (typeof pgn !== "string" || Buffer.byteLength(pgn) > MAX_PGN_BYTES) return null;
  let parsed = null;
  for await (const record of parsePgnStream(pgn)) {
    if (parsed) return null; // A parent game must retain exactly one PGN mainline.
    parsed = record;
  }
  if (!parsed?.valid || parsed.result !== getSevenTagRoster(game).Result || parsed.moves.length !== moves.length ||
      !isDeepStrictEqual(parsed.finalBoard, game.board_state) ||
      !parsed.moves.every((move, index) =>
        isDeepStrictEqual(move.from, moves[index].from_position) &&
        isDeepStrictEqual(move.to, moves[index].to_position) &&
        String(move.promotion || "").toLowerCase() === String(moves[index].promotion || "").toLowerCase())) return null;
  const value = JSON.stringify({ version: 1, gameId: game.id, moves });
  if (Buffer.byteLength(value) > MAX_ARCHIVE_BYTES) return null;
  return { pgn, moveArchive: "gzip:" + zlib.gzipSync(value).toString("base64") };
}

/** Retain board, clocks, timestamps and extra move columns for every replay path. */
function restoreArchivedMoves(game, liveMoves = []) {
  if (!game.moves_archived_at) return liveMoves;
  if (liveMoves.length) {
    if (!completeMoveSequence(game, liveMoves)) throw new Error("Archived game has an incomplete live move sequence");
    return liveMoves;
  }
  try {
    if (typeof game.move_archive !== "string" || !/^gzip:[A-Za-z0-9+/]+={0,2}$/.test(game.move_archive) ||
        game.move_archive.length > MAX_ARCHIVE_BYTES * 2) throw new Error("Invalid archive encoding");
    const bytes = zlib.gunzipSync(Buffer.from(game.move_archive.slice(5), "base64"), { maxOutputLength: MAX_ARCHIVE_BYTES });
    const archive = JSON.parse(bytes.toString("utf8"));
    if (archive.version !== 1 || archive.gameId !== game.id || !completeMoveSequence(game, archive.moves)) {
      throw new Error("Invalid archive sequence");
    }
    return archive.moves;
  } catch (error) {
    throw new Error("Stored move archive is corrupt or incomplete", { cause: error });
  }
}

module.exports = { prepareMoveArchive, restoreArchivedMoves };
