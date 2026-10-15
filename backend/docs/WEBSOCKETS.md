# Chesster WebSocket Protocol Specification

The Chesster backend uses **Socket.io** (`v4.x`) to power low-latency real-time chess move propagation, game clock synchronizations, spectator reactions, in-game chat, and tournament progression alerts.

---

## 1. Connection & Handshake

### 1.1 Connection URL
- **Local Development**: `ws://localhost:3000` (or `http://localhost:3000` with WebSocket transport)
- **Production**: `wss://api.chesster.app` (configured via `VITE_BACKEND_URL`)

### 1.2 Authentication & Handshake
Clients connect using the standard Socket.io client:
```javascript
import { io } from "socket.io-client";

const socket = io("http://localhost:3000", {
  transports: ["websocket", "polling"],
  auth: {
    token: "<JWT_AUTH_TOKEN>", // Optional for spectators; required for player moves and rated play
    walletAddress: "GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI"
  }
});
```

The server validates the JWT against `JWT_SECRET` via `verifySocketToken(token)`. When valid, the socket is bound to the player's wallet address and authorized for player-only events.

## 1.3 Webhook verification

Webhook requests include `X-Chesster-Timestamp` and `X-Chesster-Signature` headers. To verify a request, reject timestamps outside the subscriber's replay window, then compute the HMAC-SHA256 hex digest of `${timestamp}.${rawRequestBody}` with the subscriber secret. Accept only when it matches the `v1` value in `X-Chesster-Signature` (`t=<timestamp>,v1=<digest>`). Use the raw body bytes before JSON parsing.

---

## 2. Room & Channel Architecture

Socket connections are organized into logical rooms:
- **`game:<gameCode>`**: Broadcast room for all players and spectators watching match `<gameCode>`.
- **`tournament:<tournamentId>`**: Broadcast room for tournament bracket and match ready alerts.
- **`user:<walletAddress>`**: Private unicast notification channel for invitations and match queue alerts.

---

## 3. Client-to-Server Events

### `join-game`
Subscribe to game updates and chat for a specific room.
```json
{
  "gameCode": "CHESS789",
  "playerColor": "white"
}
```
*Note: May also be sent as a raw string `"CHESS789"` for backwards compatibility.*

---

### `leave-game`
Unsubscribe and leave the game room.
```json
{
  "gameCode": "CHESS789"
}
```

---

### `move` / `make_move`
Submit a candidate chess move to the server move authority.
```json
{
  "gameCode": "CHESS789",
  "from": [6, 4],
  "to": [4, 4],
  "promotion": "q"
}
```
- `from` and `to`: 0-indexed `[row, col]` coordinates (where `[0,0]` is top-left, a8 for white).
- `promotion`: Optional piece type `q`, `r`, `b`, or `n`.

---

### `send-chat`
Send an in-game message (subject to slow mode and profanity filter).
```json
{
  "gameCode": "CHESS789",
  "playerColor": "white",
  "message": "Good luck, have fun!"
}
```

---

### `spectator:reaction`
Broadcast a floating emoji reaction to all users watching the match.
```json
{
  "gameCode": "CHESS789",
  "emoji": "🔥"
}
```

---

### `reconnect_game`
Resume an active match after an abrupt connection drop.
```json
{
  "gameId": "CHESS789",
  "walletAddress": "GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

---

### `request-rematch`
Request a rematch game after match conclusion.
```json
{
  "gameCode": "CHESS789",
  "playerColor": "white"
}
```

---

## 4. Server-to-Client Events

### `game-update`
Emitted whenever the board state, turn, or match status changes.
```json
{
  "game_code": "CHESS789",
  "status": "active",
  "current_turn": "black",
  "board_state": [
    ["r", "n", "b", "q", "k", "b", "n", "r"],
    ["p", "p", "p", "p", "p", "p", "p", "p"],
    [".", ".", ".", ".", ".", ".", ".", "."],
    [".", ".", ".", ".", ".", ".", ".", "."],
    [".", ".", ".", ".", "P", ".", ".", "."],
    [".", ".", ".", ".", ".", ".", ".", "."],
    ["P", "P", "P", "P", ".", "P", "P", "P"],
    ["R", "N", "B", "Q", "K", "B", "N", "R"]
  ],
  "white_seconds_left": 298,
  "black_seconds_left": 300,
  "winner": null,
  "end_reason": null
}
```

---

### `timer-tick`
Periodic clock synchronization broadcast.
```json
{
  "gameCode": "CHESS789",
  "whiteSecondsLeft": 284,
  "blackSecondsLeft": 300,
  "activeColor": "white"
}
```

---

### `presence-update`
Player connectivity and reconnecting state.
```json
{
  "gameCode": "CHESS789",
  "color": "black",
  "status": "reconnecting",
  "forfeited": false
}
```

---

### `player_status`
Status transition with explicit grace countdown duration.
```json
{
  "color": "black",
  "status": "disconnected",
  "graceMs": 60000
}
```

---

### `opponent_disconnected`
Direct alert dispatched to the remaining connected player.
```json
{
  "gameCode": "CHESS789",
  "color": "black",
  "graceTimeSeconds": 60
}
```

---

### `opponent_reconnected` / `player_reconnected`
Dispatched when the disconnected player returns before grace timeout.
```json
{
  "gameCode": "CHESS789",
  "color": "black"
}
```

---

### `game_over`
Dispatched on checkmate, draw, resignation, or abandonment forfeit.
```json
{
  "gameCode": "CHESS789",
  "winner": "white",
  "reason": "abandonment"
}
```

---

### `chat-message`
Broadcasts an approved chat message to room participants.
```json
{
  "id": "msg_98765",
  "playerColor": "white",
  "message": "Good luck, have fun!",
  "createdAt": "2026-10-15T16:00:00.000Z"
}
```

---

### `spectator:reaction`
Broadcasts spectator reactions.
```json
{
  "gameCode": "CHESS789",
  "emoji": "🔥",
  "id": "react_12345",
  "xOffset": 45
}
```

---

### `tournament:match_ready`
Notifies registered tournament players that their bracket match is ready to start.
```json
{
  "gameCode": "TOURNEY_MATCH_1",
  "round": 1,
  "opponentName": "StellarGrandmaster",
  "opponentRating": 1750,
  "color": "white"
}
```

---

### `tournament:match_completed`
Broadcasts resolved match results across tournament viewers to advance brackets.
```json
{
  "tournamentId": "tourney_abc123",
  "matchNumber": 1,
  "winner": "GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI",
  "whiteScore": 1,
  "blackScore": 0,
  "status": "resolved"
}
```

---

## 5. Disconnection & Forfeit Lifecycle

```
[Active Game]
     │
     ▼ (Socket Disconnect)
[Start 60s Grace Timer]
     ├── Emits `opponent_disconnected` (graceTimeSeconds: 60)
     ├── Emits `presence-update` (status: "reconnecting")
     │
     ├───► If Reconnect within 60s:
     │        ├── Clear Grace Timer
     │        └── Emits `opponent_reconnected` & `player_reconnected`
     │
     └───► If Timer expires (60s elapsed):
              ├── Forfeit Game to opponent
              ├── Emits `game_over` (reason: "abandonment", winner: opponent)
              ├── Emits `presence-update` (status: "offline", forfeited: true)
              └── Trigger on-chain escrow payout settlement
```
