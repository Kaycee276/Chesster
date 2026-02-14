## Chesster Escrow Smart Contract

A non-custodial, decentralized escrow for equal-stakes chess match wagering with backend coordination.

### Features

- **Equal-stakes wagering**: Creator sets wager amount; joiner must match it exactly
- **Dual-phase locking**: Tokens locked on creation + joiner join (becomes ACTIVE)
- **Backend-coordinated settlement**: Coordinator signals winner → contract pays out
- **Draw support**: Special DRAW address (0xdead...) for draws; both players refunded equally
- **Automatic timeout refunds**: After 1 hour with no resolution, anyone can call refund
- **ERC-20 support**: Works with any ERC-20 token (USDC, DAI, etc.)

### Contract: `ChessterEscrow.sol`

#### Key Functions

**`createMatch(bytes32 gameCode, address token, uint256 wagerAmount)`**
- Creator calls this after game is created
- Requires prior `approve()` to contract for `wagerAmount` tokens
- Pulls tokens from creator → locks them
- Match enters PENDING state

**`joinMatch(bytes32 gameCode)`**
- Joiner calls this to join the match
- Requires prior `approve()` for same `wagerAmount`
- Pulls tokens from joiner → match becomes ACTIVE
- Both players' tokens now in escrow, total = 2 × wagerAmount

**`resolveMatch(bytes32 gameCode, address winner)`**
- Only coordinator can call (enforced by onlyCoordinator modifier)
- `winner` can be:
  - Player1 or Player2 address → winner gets full pot (2 × wagerAmount)
  - DRAW_ADDRESS (0x000...dead) → both refunded equally (wagerAmount each)
- Match moves to RESOLVED; tokens transferred immediately

**`refundAfterTimeout(bytes32 gameCode)`**
- Public function; anyone can call
- Requires 1 hour elapsed since match creation
- Only works if match is PENDING or ACTIVE (not already RESOLVED)
- Refunds both players their original stakes

**`getMatch(bytes32 gameCode)` (view)**
- Returns full match struct: players, token, wager, status, winner, timestamp

#### Match States

```
PENDING (0)   → Creator locked stake, waiting for joiner
    ↓
ACTIVE (1)    → Both players locked stakes, game in progress
    ↓
RESOLVED (2)  → Coordinator called resolveMatch(), payouts done
    ↓ (or auto-refund after 1hr)
REFUNDED (3)  → Automatic timeout refund issued
```

### Backend Integration

#### Setup

1. **Install ethers.js in backend**:
   ```bash
   npm install ethers
   ```

2. **Set environment variables** in `.env`:
   ```
   ESCROW_CONTRACT_ADDRESS=0x...    # Deployed contract address
   COORDINATOR_PRIVATE_KEY=0x...    # Backend coordinator wallet private key
   RPC_URL=https://...              # Ethereum RPC endpoint (or local)
   ```

3. **Register routes** in `server.js` (already done):
   ```javascript
   const escrowRoutes = require("./routes/escrowRoutes");
   app.use("/api/escrow", escrowRoutes);
   ```

#### Escrow API Endpoints

**GET `/api/escrow/info`**
- Returns contract address and coordinator status

**GET `/api/escrow/:gameCode`**
- Fetch match details from contract
- Response:
  ```json
  {
    "success": true,
    "data": {
      "gameCode": "0x...",
      "player1": "0x...",
      "player2": "0x...",
      "token": "0x...",
      "wagerAmount": "1000000000000000000",
      "totalStaked": "2000000000000000000",
      "createdAt": 1707000000,
      "status": 1,
      "winner": "0x0000000000000000000000000000000000000000"
    }
  }
  ```

**POST `/api/escrow/create`**
- Creator initiates match with wager
- Body:
  ```json
  {
    "gameCode": "ABC123",
    "tokenAddress": "0x...",
    "wagerAmount": "1"
  }
  ```
- Response: `{ success: true, txHash, blockNumber }`

**POST `/api/escrow/join`**
- Joiner joins match
- Body:
  ```json
  {
    "gameCode": "ABC123"
  }
  ```
- Response: `{ success: true, txHash, blockNumber }`

**POST `/api/escrow/resolve`**
- Coordinator resolves match after game ends
- Body (for winner):
  ```json
  {
    "gameCode": "ABC123",
    "winner": "0x..." // winner address
  }
  ```
- Body (for draw):
  ```json
  {
    "gameCode": "ABC123",
    "winner": "draw"
  }
  ```
- Response: `{ success: true, txHash, blockNumber }`

### Deployment

#### Compile with Hardhat

1. **Create `hardhat.config.js`** in project root:
   ```javascript
   module.exports = {
     solidity: "0.8.17",
     networks: {
       localhost: {
         url: "http://127.0.0.1:8545"
       },
       testnet: {
         url: process.env.RPC_URL,
         accounts: [process.env.DEPLOY_KEY]
       }
     }
   };
   ```

2. **Compile**:
   ```bash
   npx hardhat compile
   ```

3. **Deploy script** (`scripts/deploy.js`):
   ```javascript
   const hre = require("hardhat");

   async function main() {
     const Escrow = await hre.ethers.getContractFactory("ChessterEscrow");
     const escrow = await Escrow.deploy();
     await escrow.deployed();
     console.log("ChessterEscrow deployed to:", escrow.address);
   }

   main();
   ```

4. **Deploy**:
   ```bash
   npx hardhat run scripts/deploy.js --network localhost
   ```

5. **Update `.env` with deployed address**

### Frontend Integration

#### User Flow

1. **Creator creates game**
   - Click "Create" → backend: `POST /api/games` → gameCode
   - Click "Wager" → web3: approve token → `POST /api/escrow/create`
   - Share link

2. **Joiner joins game**
   - Visit link → click "Play as Black"
   - Web3: approve token → `POST /api/escrow/join`
   - Game starts

3. **Game ends**
   - Backend calls `POST /api/escrow/resolve` with winner
   - Contract transfers tokens to winner

4. **Timeout refund** (if 1 hour passes)
   - Anyone calls contract's `refundAfterTimeout()` or backend route

### Security Considerations

- **Coordinator key**: Protect the `COORDINATOR_PRIVATE_KEY`; use a secure vault or multisig for production
- **Token approvals**: Users must approve before creating/joining; frontend should prompt clearly
- **Reentrancy**: Contract uses state updates before transfers; safe from reentrancy
- **Double resolution**: Once `RESOLVED`, match cannot be resolved again or refunded
- **Audit**: For production/high-stakes, have contract audited by a security firm

### Testing

```bash
# Unit tests
npx hardhat test

# Local testnet (Ganache/Hardhat)
npx hardhat node
npx hardhat run scripts/deploy.js --network localhost

# Testnet (Goerli, Sepolia, etc.)
npx hardhat run scripts/deploy.js --network testnet
```

### Next Steps

- [ ] Implement frontend wallet UI (approve + call escrow endpoints)
- [ ] Wire backend game resolution to call `resolveMatch`
- [ ] Test with real ERC-20 on testnet
- [ ] Add dispute arbitration (signature-based off-chain resolution fallback)
- [ ] Implement smart contract upgrades (proxy pattern) for live updates
