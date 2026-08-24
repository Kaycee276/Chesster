# Development Guide & Pre-Commit Git Hooks ♟️

This document outlines the local development setup, CI verification checks, and pre-commit Git hook configurations for **Chesster**.

---

## 🛠️ Local Setup & CI Checks

### 1. Root Installation

Run `npm install` at the repository root. This will install workspace tooling (such as **Husky** and **lint-staged**) and automatically register Git hooks via the `prepare` script in `package.json`.

```bash
npm install
```

### 2. Service Dependencies & Development Servers

- **Frontend**:
  ```bash
  cd frontend
  npm install
  npm run dev
  ```
- **Backend**:
  ```bash
  cd backend
  npm install
  npm run dev
  ```
- **Smart Contracts**:
  ```bash
  cd contracts/soroban
  cargo build
  ```

### 3. Running Local CI Checks

Before opening a Pull Request, make sure all local checks pass:

- **Frontend Linting**:
  ```bash
  cd frontend && npm run lint
  ```
- **Backend Unit Tests**:
  ```bash
  cd backend && npm test
  ```
- **Smart Contract Tests**:
  ```bash
  cd contracts/soroban && cargo test
  ```

---

## ⚓ Pre-Commit Git Hooks (Husky & Lint-Staged)

To ensure code quality and prevent broken code or unformatted commits from entering the repository, **Husky** and **lint-staged** are configured at the repository root.

### How It Works

When you run `git commit`, Husky intercepts the commit process via `.husky/pre-commit` and invokes `npx lint-staged`.

`lint-staged` inspects only the files currently staged for commit and runs specific linters and test suites:

| Target Files | Command Executed | Purpose |
| --- | --- | --- |
| `frontend/**/*.{js,jsx,ts,tsx}` | `eslint --fix --config frontend/eslint.config.js` | Auto-fixes ESLint errors and formatting issues on staged frontend code. |
| `backend/**/*.{js,ts}` | `npm test --prefix backend -- --passWithNoTests` | Runs Jest unit tests affected by staged backend code changes. |

If any check fails, the commit is aborted with clear error output detailing the issues that must be resolved.

### Manual Verification

You can manually trigger lint-staged at any time to verify staged files:

```bash
npx lint-staged
```

### Re-installing Hooks

If Husky hooks become uninstalled or out of sync (for instance, after cloning or pulling new changes), run:

```bash
npm run prepare
```

### Bypassing Hooks (Emergency Only)

If you must temporarily bypass pre-commit checks during local experimentation, pass `--no-verify` (or `-n`) to `git commit`:

```bash
git commit -m "WIP: temporary local test" --no-verify
```

> **Note:** Bypassing pre-commit hooks is strongly discouraged for Pull Requests, as failing checks will be caught by remote CI pipelines.
