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
- **Backend Unit Tests & Coverage**:
  ```bash
  cd backend && npm run test:coverage
  ```
- **Frontend Unit Tests & Coverage**:
  ```bash
  cd frontend && npm run test:coverage
  ```
- **Smart Contract Tests**:
  ```bash
  cd contracts/soroban && cargo test
  ```

---

## 🐳 Containerized Development with Docker Compose

For a complete containerized full-stack development environment without manually managing local dependencies (Node.js, PostgreSQL, etc.), use the root `docker-compose.yml`:

### 1. Start All Services
Launch the PostgreSQL database, Express backend, and Vite frontend with volume hot-reloading:

```bash
docker compose up --build
```

To run in detached mode in the background:
```bash
docker compose up -d
```

### 2. Service Endpoints
| Service | Local URL | Description |
| --- | --- | --- |
| **Frontend UI** | `http://localhost:3090` | Vite React development server with hot-module reloading |
| **Backend API** | `http://localhost:3001` | Express REST & WebSocket game server |
| **PostgreSQL** | `localhost:5432` | Postgres 16 database (`chesster_db`) |

### 3. View Logs & Container Status
- View combined live logs:
  ```bash
  docker compose logs -f
  ```
- View logs for a specific service:
  ```bash
  docker compose logs -f backend
  ```

### 4. Stop & Teardown
- Stop running containers:
  ```bash
  docker compose down
  ```
- Stop containers and purge persistent database volumes:
  ```bash
  docker compose down -v
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

---

## 🔒 Branch Protection Verification

Maintaining branch governance requires ensuring that only pull requests passing all CI checks can merge into protected branches. This script audits GitHub branch protection rules to verify required status checks and review requirements.

### Prerequisites

- **GitHub Token**: A personal access token (classic) with the `repo` scope
  - Must have **push or admin access** to the target repository — the GitHub API returns 404 for branch protection endpoints without it
- **Node.js**: Installed and available in PATH
- **Git Remote**: Script auto-detects repository from `origin` remote

### Setting Up Authentication

```bash
export GITHUB_TOKEN=ghp_xxxxxxxxxxxx
```

You can generate a token at [GitHub Settings → Developer settings → Personal access tokens](https://github.com/settings/tokens).

### Usage

```bash
# Check default branches (master, dev)
npm run verify:branch-protection

# Check specific branches
npm run verify:branch-protection -- --branch master,main,dev

# Override repository (if not auto-detected from git remote)
npm run verify:branch-protection -- --repo owner/repo

# Combine flags
npm run verify:branch-protection -- --branch master,dev --repo owner/repo
```

### What It Checks

| Check | Description |
| --- | --- |
| **PR reviews required** | Verifies at least 1 approving review is required |
| **Status checks required** | Verifies CI status checks are configured |
| **Branch up-to-date** | Verifies branch must be up to date before merging |
| **Admin enforcement** | Reports whether admin bypass is disabled (informational) |

### Example Output

```
Branch Protection Report
==================================================
  Repository: ChessterOrg/Chesster
  Branches:  master, dev

✓ master — All checks passed
  ✓ PR reviews required — min 1 approval(s)
  ✓ Status checks required — 4 check(s): backend-ci, frontend-ci, contracts-ci, lint-pr
  ✓ Branch must be up date before merging — enabled
  ✓ Enforce for admins — enabled

✓ dev — All checks passed
  ✓ PR reviews required — min 1 approval(s)
  ✓ Status checks required — 4 check(s): backend-ci, frontend-ci, contracts-ci, lint-pr
  ✓ Branch must be up date before merging — enabled
  ✓ Enforce for admins — enabled

==================================================
Result: 2/2 branch(es) compliant ✓
```

### Exit Codes

| Code | Meaning |
| --- | --- |
| `0` | All branches are compliant |
| `1` | One or more branches have violations or errors |

### CI Integration

This script can be run in CI pipelines to periodically audit branch protection:

```yaml
- name: Verify Branch Protection
  run: npm run verify:branch-protection
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```
