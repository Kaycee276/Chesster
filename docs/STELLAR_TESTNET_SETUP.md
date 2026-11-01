# Local Soroban Testnet setup

This guide runs Chesster against Stellar Testnet with a local backend and the
Freighter browser wallet.

## 1. Install the tools

Install Rust and the Stellar CLI, then verify them:

```bash
rustup update stable
cargo install --locked stellar-cli
stellar --version
pnpm --version
```

Clone the repository, install dependencies, and copy the backend environment:

```bash
git clone https://github.com/Kaycee276/Chesster.git
cd Chesster
pnpm install
cp backend/.env.example backend/.env
```

## 2. Create and fund a Testnet identity

Never use a production secret key in local development. Create a disposable
Testnet identity and fund it through Friendbot:

```bash
stellar keys generate --network testnet alice
stellar keys fund alice --network testnet
stellar keys address alice
```

If your CLI version does not accept `--network` on `fund`, use the Testnet
Friendbot URL shown by `stellar network`. Confirm the account on the
[Stellar Expert Testnet explorer](https://stellar.expert/explorer/testnet).

## 3. Build and deploy the escrow contract

```bash
cd contracts/soroban
cargo build --target wasm32-unknown-unknown --release
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/chesster_escrow.wasm \
  --source-account alice \
  --network testnet
```

Copy the returned contract address into `backend/.env` as
`ESCROW_CONTRACT_ADDRESS`. Set `COORDINATOR_SECRET_KEY` to the disposable
Testnet secret for `alice`, and configure `SOROBAN_NETWORK=testnet` plus the
Testnet RPC URL. Never commit `.env` or secret keys.

## 4. Configure Freighter and run Chesster

Install [Freighter](https://www.freighter.app/), switch it to **Testnet**, and
connect the `alice` account. The frontend must use the same Testnet network
and RPC configuration as the backend.

```bash
pnpm --dir backend dev
pnpm --dir frontend dev
```

Open the frontend, connect Freighter, and approve only Testnet transactions.
You can now exercise a wagered game end to end: the frontend signs, the
backend submits, and the escrow contract holds the Testnet asset.

## Troubleshooting

- `Account not found`: fund the identity again with Friendbot and wait for it
  to appear on Testnet.
- `Contract not found`: check the contract address and network in `.env`.
- Freighter shows Mainnet: switch the extension to Testnet before connecting.
- Deployment fails: confirm the WASM filename under `contracts/soroban/target/`.
