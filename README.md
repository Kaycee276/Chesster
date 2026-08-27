<div align="center">
  <img src="./frontend/public/favicon.ico" alt="Chesster Logo" width="100" />
</div>

# Chesster - Decentralized Chess on Stellar

A fully decentralized, two-player chess game built on the Stellar network using Soroban smart contracts. Chesster features full move validation, database persistence for game state, and an on-chain escrow system for wagering tokens on matches.

![Chesster](https://img.shields.io/badge/Stellar-Soroban-black?style=flat-square&logo=stellar)
![React](https://img.shields.io/badge/React-TypeScript-blue?style=flat-square&logo=react)
![Node.js](https://img.shields.io/badge/Node.js-Express-green?style=flat-square&logo=node.js)

## 🏗 Architecture

For component responsibilities, trust boundaries, and match/escrow sequence diagrams, see the [architecture guide](docs/ARCHITECTURE.md).

```text
Chesster/
├── backend/          # Node.js + Express API
│   ├── config/       # Supabase & Stellar config
│   ├── controllers/  # Request handlers
│   ├── models/       # Database operations
│   ├── routes/       # API endpoints
│   ├── services/     # Chess engine & Escrow logic
│   └── database/     # SQL schemas
├── frontend/         # React + TypeScript
│   └── src/
│       ├── components/  # ChessBoard, GameLobby, WalletConnect
│       ├── services/    # Stellar & API services
│       └── store/       # Zustand state management
└── contracts/        # Rust / Soroban Smart Contracts
    └── soroban/
        └── contracts/
            └── escrow/  # Escrow contract for wagering
```

## ✨ Features

- **Web3 Integration**: Connect with Freighter wallet to play and wager on games.
- **On-Chain Escrow**: Secure, trustless wagering using a Soroban smart contract.
- **Full Chess Engine**: Complete move validation (pawns, rooks, knights, bishops, queens, kings, castling, en passant).
- **Real-time Gameplay**: Turn-based gameplay with real-time board updates.
- **Database Persistence**: Game state and move history stored securely in Supabase.
- **CI/CD Pipelines**: Automated testing and linting via GitHub Actions.

## 🚀 Prerequisites

Before you begin, ensure you have the following installed:

- [Node.js](https://nodejs.org/) (v20+)
- [Rust](https://www.rust-lang.org/tools/install) (for Soroban contracts)
- [Soroban CLI](https://soroban.stellar.org/docs/getting-started/setup)
- [Freighter Wallet](https://www.freighter.app/) browser extension
- A [Supabase](https://supabase.com/) account

## 🛠 Setup Instructions

### 1. Smart Contract Deployment

```bash
cd contracts/soroban
rustup target add wasm32-unknown-unknown
cargo build --target wasm32-unknown-unknown --release
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/escrow.wasm \
  --source <YOUR_SECRET_KEY> \
  --network testnet
```

_Save the deployed contract ID for the environment variables._

### 2. Supabase Setup

1. Create a new project on [Supabase](https://supabase.com).
2. Run the SQL schemas located in `backend/database/schema.sql` and `backend/database/migrations/add_escrow_columns.sql`.
3. Copy your Project URL and Anon Key.

### 3. Backend Setup

```bash
cd backend
cp .env.example .env
# Edit .env with your Supabase credentials and Soroban Contract ID
npm install
npm run dev
```

_Backend runs on http://localhost:3000_

### 4. Frontend Setup

```bash
cd frontend
cp .env.example .env
# Edit .env with your Backend URL and Soroban Contract ID
npm install
npm run dev
```

_Frontend runs on http://localhost:5173_

## 🎮 How to Play

1. **Connect Wallet**: Click "Connect Wallet" to link your Freighter extension.
2. **Player 1 (Create)**: Click "Create New Game", set a wager amount, and share the generated game code.
3. **Player 2 (Join)**: Enter the game code, approve the wager transaction in Freighter, and join as Black.
4. **Play**: Click a piece to select it, then click the destination square. All moves are validated by the backend engine.
5. **Resolution**: Upon checkmate or draw, the backend automatically calls the smart contract to distribute the wagered tokens to the winner (or refunds both players in a draw).

## 🔗 API Endpoints

- `POST /api/games` - Create a new game
- `POST /api/games/:code/join` - Join an existing game
- `GET /api/games/:code` - Get current game state
- `POST /api/games/:code/move` - Make a move
- `GET /api/games/:code/moves` - Get move history

## 📜 Smart Contract (Escrow)

The Soroban smart contract (`ChessterEscrow`) handles the financial logic of the game:

- **`init`**: Initializes the contract with a coordinator address and fee percentage.
- **`create_match`**: Player 1 locks their wager in the contract.
- **`join_match`**: Player 2 locks their matching wager.
- **`resolve_match`**: The coordinator (backend) resolves the match, paying the winner (minus a small fee) or refunding both players.
- **`refund_after_timeout`**: Allows players to reclaim funds if a match is abandoned.

## 🧪 Testing

The project includes comprehensive test suites:

- **Smart Contract**: `cd contracts/soroban && cargo test`
- **Backend**: `cd backend && npm test`

## 📄 License

This project is licensed under the MIT License.
