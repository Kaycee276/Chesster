# Chesster Backend

Scalable game backend supporting chess (extensible to other games).

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file:
```bash
cp .env.example .env
```

3. Add your Supabase credentials to `.env`:
```
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_anon_key
PORT=3000
```

4. Run the SQL schema in Supabase SQL Editor:
   - Open `database/schema.sql`
   - Copy and execute in Supabase dashboard

5. Start server:
```bash
npm run dev
```

## API Endpoints

### Create Game
```
POST /api/games
Body: { "gameType": "chess" }
Response: { "success": true, "data": { "game_code": "ABC123", ... } }
```

### Join Game
```
POST /api/games/:gameCode/join
Body: { "playerColor": "white" | "black" }
Response: { "success": true, "data": { ... } }
```

### Get Game State
```
GET /api/games/:gameCode
Response: { "success": true, "data": { "board_state": [...], ... } }
```

### Make Move
```
POST /api/games/:gameCode/move
Body: { "from": [6, 4], "to": [4, 4] }
Response: { "success": true, "data": { "board_state": [...], ... } }
```

### Get Move History
```
GET /api/games/:gameCode/moves
Response: { "success": true, "data": [...] }
```

## Board Representation

- Lowercase = black pieces (p, r, n, b, q, k)
- Uppercase = white pieces (P, R, N, B, Q, K)
- '.' = empty square
- Position format: [row, col] where [0,0] is top-left

## Architecture

```
backend/
├── config/          # Supabase configuration
├── controllers/     # Request handlers
├── models/          # Database operations
├── routes/          # API routes
├── services/        # Game logic (chess engine)
├── database/        # SQL schemas
└── server.js        # Entry point
```
