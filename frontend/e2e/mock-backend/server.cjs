/**
 * Minimal in-memory backend used only for Playwright E2E runs.
 *
 * The real backend needs live Supabase + Soroban RPC credentials that this
 * sandbox/CI does not have. This fixture implements just the REST + Socket.io
 * contract the frontend actually calls (see src/api/gameApi.ts and
 * src/api/socket.ts) so `frontend/e2e/gameplay.spec.ts` can drive the real
 * frontend UI through a full two-player game end to end. It trusts whatever
 * moves the test sends (no chess legality engine) — the spec plays a fixed,
 * legal "Fool's Mate" script and this server just applies those exact
 * from/to moves to the board and recognizes the scripted checkmate.
 */

const http = require("http");
const { Server } = require("socket.io");

const PORT = process.env.MOCK_BACKEND_PORT || 4310;

function initialBoard() {
  return [
    ["r", "n", "b", "q", "k", "b", "n", "r"],
    ["p", "p", "p", "p", "p", "p", "p", "p"],
    [".", ".", ".", ".", ".", ".", ".", "."],
    [".", ".", ".", ".", ".", ".", ".", "."],
    [".", ".", ".", ".", ".", ".", ".", "."],
    [".", ".", ".", ".", ".", ".", ".", "."],
    ["P", "P", "P", "P", "P", "P", "P", "P"],
    ["R", "N", "B", "Q", "K", "B", "N", "R"],
  ];
}

const games = new Map();

function randomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function publicGame(game) {
  return {
    game_code: game.game_code,
    status: game.status,
    board_state: game.board_state,
    current_turn: game.current_turn,
    in_check: game.in_check,
    winner: game.winner,
    end_reason: game.end_reason,
    draw_offer: game.draw_offer,
    turn_started_at: game.turn_started_at,
    time_control_seconds: game.time_control_seconds,
    game_started_at: game.game_started_at,
    captured_white: game.captured_white,
    captured_black: game.captured_black,
    last_move: game.last_move,
    wager_amount: game.wager_amount,
    token_address: game.token_address,
    escrow_status: game.escrow_status,
    player_white_address: game.player_white_address,
    player_black_address: game.player_black_address,
  };
}

function send(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    send(res, 204, {});
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const parts = url.pathname.split("/").filter(Boolean); // ["api", "games", ...]

  if (parts[0] !== "api" || parts[1] !== "games") {
    send(res, 404, { success: false, error: "not found" });
    return;
  }

  // POST /api/games
  if (parts.length === 2 && req.method === "POST") {
    const body = await readBody(req);
    const game_code = (body.gameCode || randomCode()).toUpperCase();
    const game = {
      game_code,
      status: "waiting",
      board_state: initialBoard(),
      current_turn: "white",
      in_check: false,
      winner: null,
      end_reason: null,
      draw_offer: null,
      turn_started_at: null,
      time_control_seconds: body.timeControlSeconds || 600,
      game_started_at: null,
      captured_white: [],
      captured_black: [],
      last_move: null,
      wager_amount: body.wagerAmount || null,
      token_address: null,
      escrow_status: null,
      player_white_address: body.playerWhiteAddress || null,
      player_black_address: null,
      moveCount: 0,
    };
    games.set(game_code, game);
    send(res, 201, { success: true, data: publicGame(game) });
    return;
  }

  // GET /api/games/:code
  if (parts.length === 3 && req.method === "GET") {
    const game = games.get(parts[2]);
    if (!game) {
      send(res, 404, { success: false, error: "Game not found" });
      return;
    }
    send(res, 200, { success: true, data: publicGame(game) });
    return;
  }

  // GET /api/games/:code/chat
  if (parts.length === 4 && parts[3] === "chat" && req.method === "GET") {
    send(res, 200, { success: true, data: [] });
    return;
  }

  // POST /api/games/:code/join
  if (parts.length === 4 && parts[3] === "join" && req.method === "POST") {
    const game = games.get(parts[2]);
    if (!game) {
      send(res, 400, { success: false, error: "Game not found" });
      return;
    }
    const body = await readBody(req);
    if (body.playerColor === "black") {
      game.player_black_address = body.playerAddress || null;
      game.status = "active";
      game.game_started_at = new Date().toISOString();
    } else {
      game.player_white_address = body.playerAddress || null;
    }
    send(res, 200, { success: true, data: publicGame(game) });
    io.to(game.game_code).emit("game-update", publicGame(game));
    return;
  }

  // POST /api/games/:code/move
  if (parts.length === 4 && parts[3] === "move" && req.method === "POST") {
    const game = games.get(parts[2]);
    if (!game) {
      send(res, 400, { success: false, error: "Game not found" });
      return;
    }
    if (game.status !== "active") {
      send(res, 400, { success: false, error: "Game is not active" });
      return;
    }
    const body = await readBody(req);
    const [fr, fc] = body.from;
    const [tr, tc] = body.to;
    const piece = game.board_state[fr][fc];
    game.board_state[fr][fc] = ".";
    game.board_state[tr][tc] = body.promotion
      ? piece === piece.toUpperCase()
        ? body.promotion.toUpperCase()
        : body.promotion.toLowerCase()
      : piece;
    game.last_move = { from: body.from, to: body.to, piece };
    game.moveCount += 1;
    game.current_turn = game.current_turn === "white" ? "black" : "white";

    // Scripted "Fool's Mate" recognition: 1.f3 e5 2.g4 Qh4# — the 4th
    // half-move (black queen d8->h4) delivers checkmate against white.
    if (game.moveCount === 4 && fr === 0 && fc === 3 && tr === 4 && tc === 7) {
      game.status = "finished";
      game.winner = "black";
      game.end_reason = "checkmate";
      game.in_check = true;
    }

    send(res, 200, { success: true, data: publicGame(game) });
    io.to(game.game_code).emit("game-update", publicGame(game));
    return;
  }

  send(res, 404, { success: false, error: "not found" });
});

const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

io.on("connection", (socket) => {
  socket.on("join-game", (gameCode) => {
    if (typeof gameCode === "string") socket.join(gameCode);
    else if (gameCode && gameCode.gameCode) socket.join(gameCode.gameCode);
  });
  socket.on("leave-game", (gameCode) => {
    if (typeof gameCode === "string") socket.leave(gameCode);
  });
});

server.listen(PORT, () => {
  console.log(`Mock E2E backend listening on port ${PORT}`);
});
