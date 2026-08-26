#!/usr/bin/env node
/**
 * seed.js — Local development & E2E seed data for Chesster.
 *
 * Populates the database with:
 *   - sample players (users)
 *   - completed matches (games + move history)
 *   - active lobby records (games in `waiting` status)
 *
 * Idempotent: re-running the script will not create duplicate rows. Players
 * and games are matched by a deterministic natural key (wallet_address /
 * game_code) and skipped when already present; move history for seeded games
 * is replaced on each run so it stays consistent with the game state.
 *
 * Usage:
 *   node backend/database/seed.js            # insert seed data
 *   node backend/database/seed.js --reset    # wipe seeded rows first
 *
 * Requirements (via backend/.env or environment):
 *   SUPABASE_URL        e.g. http://localhost:54321  (local Supabase)
 *   SUPABASE_ANON_KEY   anon key for the target project
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  // eslint-disable-next-line no-console
  console.error(
    "Missing Supabase credentials. Set SUPABASE_URL and SUPABASE_ANON_KEY " +
      "(e.g. in backend/.env) before running the seed script.",
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

// Deterministic, easily recognisable keys so re-runs are idempotent.
const SEED_GAME_CODE_PREFIX = "SEED";
const SEED_WALLET_PREFIX = "GSEED";

// ---------------------------------------------------------------------------
// Sample data definitions
// ---------------------------------------------------------------------------

const PLAYERS = [
  { username: "Alice", country: "US", bio: "Bullet specialist" },
  { username: "Bob", country: "GB", bio: "Positional player" },
  { username: "Carol", country: "DE", bio: "Lichess refugee" },
  { username: "Dave", country: "NG", bio: "Blitz grinder" },
  { username: "Eve", country: "FR", bio: "Weekend warrior" },
];

const INITIAL_BOARD = {
  board: Array(8)
    .fill(null)
    .map(() => Array(8).fill(null)),
  turn: "white",
  fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
};

const LOBBY_GAMES = [
  { code: `${SEED_GAME_CODE_PREFIX}LOBBY1`, wager: null, preset: "rapid" },
  { code: `${SEED_GAME_CODE_PREFIX}LOBBY2`, wager: 10, preset: "blitz" },
  { code: `${SEED_GAME_CODE_PREFIX}LOBBY3`, wager: 50, preset: "bullet" },
];

const COMPLETED_GAMES = [
  {
    code: `${SEED_GAME_CODE_PREFIX}FIN001`,
    winner: "white",
    wager: 25,
    preset: "rapid",
    white: 0,
    black: 1,
  },
  {
    code: `${SEED_GAME_CODE_PREFIX}FIN002`,
    winner: "black",
    wager: 100,
    preset: "blitz",
    white: 2,
    black: 3,
  },
  {
    code: `${SEED_GAME_CODE_PREFIX}FIN003`,
    winner: "white",
    wager: null,
    preset: "classical",
    white: 4,
    black: 0,
  },
];

// A short, valid-looking move list for completed games.
function buildMoves(gameId, whiteAddr, blackAddr) {
  const squares = [
    { from: { file: "e", rank: 2 }, to: { file: "e", rank: 4 }, piece: "P" },
    { from: { file: "e", rank: 7 }, to: { file: "e", rank: 5 }, piece: "p" },
    { from: { file: "g", rank: 1 }, to: { file: "f", rank: 3 }, piece: "N" },
    { from: { file: "b", rank: 8 }, to: { file: "c", rank: 6 }, piece: "n" },
    { from: { file: "f", rank: 1 }, to: { file: "f", rank: 3 }, piece: "B" },
  ];
  const moves = [];
  for (let i = 0; i < squares.length; i += 1) {
    const isWhite = i % 2 === 0;
    moves.push({
      game_id: gameId,
      move_number: i + 1,
      player: isWhite ? "white" : "black",
      from_position: { file: squares[i].from.file, rank: Number(squares[i].from.rank) },
      to_position: { file: squares[i].to.file, rank: Number(squares[i].to.rank) },
      piece: squares[i].piece,
      board_state_after: INITIAL_BOARD,
      created_at: new Date(Date.now() + i * 1000).toISOString(),
    });
  }
  return moves;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function ensurePlayers() {
  const created = [];
  for (let i = 0; i < PLAYERS.length; i += 1) {
    const p = PLAYERS[i];
    const walletAddress = `${SEED_WALLET_PREFIX}${String(i + 1).padStart(4, "0")}`;

    const { data: existing } = await supabase
      .from("users")
      .select("id")
      .eq("wallet_address", walletAddress)
      .maybeSingle();

    if (existing) {
      created.push({ ...p, wallet_address: walletAddress, id: existing.id });
      // eslint-disable-next-line no-console
      console.log(`  • player ${walletAddress} already exists, skipping`);
      continue;
    }

    const { data, error } = await supabase
      .from("users")
      .insert({
        wallet_address: walletAddress,
        username: p.username,
        bio: p.bio,
        country: p.country,
        avatar_url: `https://api.dicebear.com/7.x/identicon/svg?seed=${p.username}`,
      })
      .select("id")
      .single();

    if (error) throw error;
    created.push({ ...p, wallet_address: walletAddress, id: data.id });
    // eslint-disable-next-line no-console
    console.log(`  • created player ${walletAddress} (${p.username})`);
  }
  return created;
}

async function upsertGame(game, players) {
  const { data: existing } = await supabase
    .from("games")
    .select("id")
    .eq("game_code", game.code)
    .maybeSingle();

  if (existing) {
    // eslint-disable-next-line no-console
    console.log(`  • game ${game.code} already exists, skipping insert`);
    return existing.id;
  }

  const whiteIdx = game.white != null ? game.white : 0;
  const blackIdx = game.black != null ? game.black : 1;
  const whitePlayer = players[whiteIdx];
  const blackPlayer = players[blackIdx];

  const payload = {
    game_code: game.code,
    game_type: "chess",
    board_state: INITIAL_BOARD,
    current_turn: "white",
    status: game.wager != null ? "completed" : "waiting",
    wager_amount: game.wager,
    time_control_preset: game.preset,
    time_control_seconds: 600,
    time_increment_seconds: 0,
  };

  if (game.status === "completed" || game.winner) {
    payload.status = "completed";
    payload.winner = game.winner;
    payload.player_white_address = whitePlayer.wallet_address;
    payload.player_black_address = blackPlayer.wallet_address;
    payload.player_white = true;
    payload.player_black = true;
    payload.move_count = 5;
    payload.escrow_status = game.wager != null ? { state: "resolved" } : null;
  } else {
    payload.player_white_address = whitePlayer.wallet_address;
    payload.player_white = true;
  }

  const { data, error } = await supabase
    .from("games")
    .insert(payload)
    .select("id")
    .single();

  if (error) throw error;
  // eslint-disable-next-line no-console
  console.log(`  • created game ${game.code} (${payload.status})`);
  return data.id;
}

async function seedMovesFor(gameId, gameCode, players, game) {
  // Replace any prior move history for this seeded game (idempotent).
  const { error: delError } = await supabase
    .from("moves")
    .delete()
    .eq("game_id", gameId);
  if (delError) throw delError;

  const whitePlayer = players[game.white];
  const blackPlayer = players[game.black];
  const moves = buildMoves(gameId, whitePlayer.wallet_address, blackPlayer.wallet_address);

  if (moves.length === 0) return;
  const { error } = await supabase.from("moves").insert(moves);
  if (error) throw error;
  // eslint-disable-next-line no-console
  console.log(`  • seeded ${moves.length} moves for ${gameCode}`);
}

async function resetSeedData() {
  // eslint-disable-next-line no-console
  console.log("Resetting seeded data...");
  const codes = [
    ...LOBBY_GAMES.map((g) => g.code),
    ...COMPLETED_GAMES.map((g) => g.code),
  ];
  const { data: games } = await supabase
    .from("games")
    .select("id")
    .in("game_code", codes);
  if (games && games.length > 0) {
    const ids = games.map((g) => g.id);
    await supabase.from("moves").delete().in("game_id", ids);
    await supabase.from("games").delete().in("game_code", codes);
  }
  const wallets = PLAYERS.map(
    (_, i) => `${SEED_WALLET_PREFIX}${String(i + 1).padStart(4, "0")}`,
  );
  await supabase.from("users").delete().in("wallet_address", wallets);
  // eslint-disable-next-line no-console
  console.log("Reset complete.");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const shouldReset = process.argv.includes("--reset");
  if (shouldReset) await resetSeedData();

  // eslint-disable-next-line no-console
  console.log("Seeding players...");
  const players = await ensurePlayers();

  // eslint-disable-next-line no-console
  console.log("Seeding active lobby games...");
  for (const g of LOBBY_GAMES) {
    await upsertGame(g, players);
  }

  // eslint-disable-next-line no-console
  console.log("Seeding completed matches...");
  for (const g of COMPLETED_GAMES) {
    const id = await upsertGame(g, players);
    await seedMovesFor(id, g.code, players, g);
  }

  // eslint-disable-next-line no-console
  console.log("✅ Seed complete.");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("❌ Seed failed:", err.message || err);
  process.exit(1);
});
