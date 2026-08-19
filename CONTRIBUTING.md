# Contributing to Chesster ♟️

Thank you for your interest in contributing to **Chesster**, a decentralized chess game on the Stellar network powered by Soroban smart contracts! 

We welcome contributions of all kinds: bug fixes, new features, UI/UX improvements, documentation updates, and smart contract enhancements.

---

## 📋 Table of Contents

- [Getting Started](#getting-started)
- [How to Claim an Issue](#how-to-claim-an-issue)
- [Development Setup](#development-setup)
  - [Prerequisites](#prerequisites)
  - [Backend Setup](#backend-setup)
  - [Frontend Setup](#frontend-setup)
  - [Smart Contracts Setup](#smart-contracts-setup)
- [Commit & Branching Guidelines](#commit--branching-guidelines)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Community & Support](#community--support)

---

## 🚀 Getting Started

1. **Find an Issue**: Browse our [GitHub Issues](https://github.com/Kaycee276/Chesster/issues). Look out for issues tagged with:
   - `good first issue`: Ideal for first-time contributors.
   - `help wanted`: Open for community contribution.
   - `bug`: Needs fixing.
   - `enhancement`: Feature improvements.
2. **Propose an Issue**: If you find a bug or have a feature idea that isn't listed, please [create a new issue](https://github.com/Kaycee276/Chesster/issues/new/choose) first before submitting a PR.

---

## 🙋‍♂️ How to Claim an Issue

To prevent duplicate work:
1. Leave a comment on the issue asking to be assigned (e.g., *"I'd like to work on this issue! Please assign me."*).
2. Wait for a maintainer to assign the issue to you before you start coding.
3. If an assigned contributor is inactive for more than **5 days**, the issue may be reassigned.

---

## 🛠 Development Setup

### Prerequisites
- **Node.js** (v20+) & `npm`
- **Rust** (latest stable) & **Soroban CLI**
- **Freighter Wallet** browser extension

### 1. Fork & Clone
```bash
git clone https://github.com/<your-username>/Chesster.git
cd Chesster
```

### 2. Backend Setup
```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

### 3. Frontend Setup
```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

### 4. Smart Contracts Setup (Soroban)
```bash
cd contracts/soroban
rustup target add wasm32-unknown-unknown
cargo build --target wasm32-unknown-unknown --release
cargo test
```

---

## 🏷 Commit & Branching Guidelines

We follow the **Conventional Commits** specification for clear git history:

### Branch Naming Pattern
- `feat/short-description` (e.g., `feat/wallet-disconnect-button`)
- `fix/short-description` (e.g., `fix/board-flip-bug`)
- `docs/short-description` (e.g., `docs/update-setup-instructions`)

### Commit Messages
- `feat(frontend): add dark mode toggle`
- `fix(backend): correct chess move validation for castling`
- `docs(readme): add troubleshooting section`
- `refactor(contracts): optimize escrow storage keys`

---

## 📥 Submitting a Pull Request

1. **Keep PRs Focused**: Address one issue per Pull Request.
2. **Run Tests**: Ensure tests pass locally before opening a PR:
   - Backend: `cd backend && npm test`
   - Contracts: `cd contracts/soroban && cargo test`
3. **Reference the Issue**: Include `Fixes #<issue-number>` or `Closes #<issue-number>` in your PR description.
4. **Request Review**: Tag a maintainer for review once your PR is ready.

---

Thank you for contributing to Chesster! 🚀
