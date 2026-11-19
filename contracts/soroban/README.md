# Soroban Project

## Project Structure

This repository uses the recommended structure for a Soroban project:

```text
.
├── contracts
│   └── hello_world
│       ├── src
│       │   ├── lib.rs
│       │   └── test.rs
│       └── Cargo.toml
├── Cargo.toml
└── README.md
```

- New Soroban contracts can be put in `contracts`, each in their own directory. There is already a `hello_world` contract in there to get you started.
- If you initialized this project with any other example contracts via `--with-example`, those contracts will be in the `contracts` directory as well.
- Contracts should have their own `Cargo.toml` files that rely on the top-level `Cargo.toml` workspace for their dependencies.
- Frontend libraries can be added to the top-level directory as well. If you initialized this project with a frontend template via `--frontend-template` you will have those files already included.

## Protocol fee governance

The coordinator proposes base protocol fee changes with
`propose_protocol_fee(admin, new_fee_bps)` and activates them with
`apply_protocol_fee(admin)` after 172,800 seconds (48 hours) of ledger time.
The fee stays unchanged during the notice period. The maximum proposed fee is
1,000 basis points (10 percent); zero is allowed. Replacing a pending proposal
restarts the full 48 hour delay. Both operations require the current
coordinator's authentication and emit `FeeChangeProposedEvent` /
`FeeChangeAppliedEvent` under `fee_change_proposed` / `fee_change_applied` topics.

The legacy `set_fee_bps` entrypoint now creates a proposal; administrators must
call `apply_protocol_fee` after the delay. Clients can obtain the pending fee
and activation time from the proposal event. Existing fee storage and error
codes are preserved; new errors use `EscrowErrorExt` codes 62 through 64.
