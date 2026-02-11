# Chesster - Scalable Chess Game

A two-player chess game with full move validation and database persistence.

## Architecture

```
Chesster/
├── backend/          # Node.js + Express API
│   ├── config/       # Supabase config
│   ├── controllers/  # Request handlers
│   ├── models/       # Database operations
│   ├── routes/       # API endpoints
│   ├── services/     # Chess engine logic
│   └── database/     # SQL schemas
└── frontend/         # React + TypeScript
    └── src/
        └── components/  # ChessBoard, GameLobby
```

## Setup Instructions

### 1. Supabase Setup
1. Go to [supabase.com](https://supabase.com) and create a project
2. In SQL Editor, run the schema from `backend/database/schema.sql`
3. Copy your project URL and anon key

### 2. Backend Setup
```bash
cd backend
cp .env.example .env
# Edit .env and add your Supabase credentials
npm install
npm run dev
```

Backend runs on http://localhost:3000

### 3. Frontend Setup
```bash
cd frontend
npm install
npm run dev
```

Frontend runs on http://localhost:5173

## How to Play

1. **Player 1**: Click "Create New Game" → Share the game code
2. **Player 2**: Enter game code → Click "Join as Black"
3. Click a piece to select it, then click destination square to move
4. All moves are validated and stored in Supabase

## Features

✅ Full chess move validation (pawns, rooks, knights, bishops, queens, kings)
✅ Two-player turn-based gameplay
✅ Real-time board updates (polling every 2s)
✅ Move history stored in database
✅ Scalable architecture for adding more games
✅ Clean separation of concerns (MVC pattern)

## API Endpoints

- `POST /api/games` - Create new game
- `POST /api/games/:code/join` - Join game
- `GET /api/games/:code` - Get game state
- `POST /api/games/:code/move` - Make move
- `GET /api/games/:code/moves` - Get move history

## Database Schema

**games table**: Stores game state, board position, turn, status
**moves table**: Records every move with position, piece, and resulting board state

## Extending to Other Games

The architecture supports multiple game types:
1. Add new engine in `services/` (e.g., `checkersEngine.js`)
2. Update `gameModel.js` to handle different game types
3. Create new frontend component for the game board
4. Use same API endpoints with different `gameType` parameter
