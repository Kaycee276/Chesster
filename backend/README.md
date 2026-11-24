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

## API & WebSocket Documentation

- **OpenAPI 3.0 Specification**: [`docs/openapi.yaml`](./docs/openapi.yaml)
- **Interactive Swagger UI**: Start the server and navigate to `http://localhost:3000/api-docs`
- **WebSocket Protocol Reference**: [`docs/WEBSOCKETS.md`](./docs/WEBSOCKETS.md)

### Previewing OpenAPI in Swagger Editor
1. Open the [Swagger Editor](https://editor.swagger.io/).
2. Click **File** > **Import File** in the top navigation bar.
3. Select `backend/docs/openapi.yaml` from your local checkout.
4. Test request schemas, inspect endpoints, and try out live requests against `http://localhost:3000/api`.

## Stellar wallet sign in

Set `REDIS_URL`, a strong `JWT_SECRET`, and `AUTH_ALLOWED_ORIGINS` (comma separated
exact origins, including scheme and port). Wallet authentication requires Redis;
it returns an error rather than accepting a local challenge when Redis is down.
Wildcards in `CORS_ORIGIN` do not authorize wallet login. Local development can
use `http://localhost:3090`; production must configure explicit allowed origins.

1. Call `GET /api/auth/nonce?address=<Stellar G address>&uri=<encoded client URI>`
   with the browser's `Origin` header. The response's `data` contains `nonce`,
   `message`, `domain`, `uri`, `issuedAt`, and `expirationTime`. Responses are
   marked `Cache-Control: no-store`.
2. Sign the exact UTF-8 `message` with the wallet. The message binds the wallet,
   domain, client URI, issuance time, and expiry in an EIP-4361-style Stellar
   sign in challenge. SEP-0043 defines the wallet interface and hex signature
   format; it does not prescribe the challenge grammar.
3. Send `{ address, message, signature, uri }` to `POST /api/auth/verify` from
   the same origin. `signature` is a 64-byte Ed25519 signature encoded as hex
   (SEP-0043), or set `signatureEncoding: "base64"` explicitly. The response
   includes the JWT and user profile, retaining session rotation and IP binding.

Nonces contain 32 random bytes, have a strict 300-second Redis TTL, and are
atomically removed on the first verification attempt, including failed
signatures. Request a new challenge after any failed attempt. Reissuing a
challenge invalidates the previous one. Concurrent requests across servers can
consume each challenge only once.

`POST /api/auth/challenge` and `POST /api/auth/login` retain their existing
message/base64 response and signature formats, using the same Redis and origin
checks. Account deletion uses `purpose: "delete-account"` and cannot reuse a
login challenge; it also requires the original `Origin` and optional `uri`.

### WebSocket handshake protection

Initial Engine.IO handshakes use a shared Redis token bucket per client IP,
with a capacity of 30 attempts and a refill rate of 30 tokens per minute.
Each attempt refreshes the bucket's 60 second inactivity expiration. Excess
polling requests and WebSocket upgrades receive HTTP 429 with `Retry-After`
and `Too many connection attempts` before a connection is allocated.
Requests belonging to an existing session are not counted again.

When Redis is unavailable, a local LRU cache holds at most 10,000 IP buckets.
It also tracks attempts while Redis is healthy, preserving local usage during
an outage. This fallback is per process; Redis provides the shared cluster limit.
Loopback connections are subject to the same limits. Forwarding headers are
only used behind peers configured in `TRUSTED_PROXIES`, using the first
untrusted address in the proxy chain; otherwise the socket's remote IP is used.
