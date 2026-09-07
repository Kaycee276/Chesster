# Tournament System Issue Generation Reference for `osswc-issues-gen`

When invoking `osswc-issues-gen` on the Chesster repository:

## Prioritization Rule
1. **Audit Open Backlog**: First, check for any unaddressed missing capabilities or open audit issues in the project (e.g. security rate limiters, database RLS policies, test coverage gaps).
2. **Tournament System Issues**: Next, generate structured issues targeting the **Tournament System** based on `docs/TOURNAMENT_SYSTEM_PLAN.md`.

## Target Component Sequence
- **Soroban Contracts**: `complete_tournament`, refund window, escrow payout distribution.
- **Backend API & Service**: Bracket seeding engine, round advancement listener, Socket.io broadcasts, REST endpoints.
- **Frontend App**: `TournamentPage.tsx`, `TournamentBracket.tsx`, `TournamentQueueModal.tsx`, `TournamentPodium.tsx`.
- **Testing**: Contract unit tests in Rust, backend bracket advancement tests in Jest.
