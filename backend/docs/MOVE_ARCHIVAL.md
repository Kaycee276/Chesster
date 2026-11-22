# Historical move retention

Migration `035_preserve_move_archives.sql` adds `games.pgn`,
`games.move_archive` and `games.moves_archived_at`. Apply it before invoking
`archivalService.archiveOldGameMoves({ olderThanDays: 90, batchSize: 500, dryRun: false })`.

The routine retains each game, audit log and chat row. It prunes move rows from
the existing monthly partitions only when the game is terminal (`finished` or
`completed`), both its completion/last-update age and its last update are older
than the cutoff, and it has no soft deletion, cheat flag or pending dispute.
`ended_at` is preferred; legacy games without it use `updated_at`.

One invocation examines at most `batchSize` games. Dry run returns candidate
IDs without connecting a transaction or changing data. Real runs use one
transaction per game, recheck eligibility and take a parent `FOR UPDATE SKIP
LOCKED` lock. Locked games are skipped for a subsequent run. Move-row locks
and 2-second lock/15-second statement timeouts bound database blocking;
archival never drops, detaches or takes an exclusive lock on a partition.

Before pruning, the routine verifies the complete consecutive move count,
PGN mainline and final board. A valid existing PGN is preserved verbatim; a
missing PGN is generated. Histories that cannot be proven complete are skipped.
A versioned gzip/base64 blob retains every move column, including board
snapshots, timestamps, clocks and engine annotations. The PGN and compressed
blob are written to the parent and read back before deletion. Save, read-back,
delete or commit failures roll back that game. Already archived games are
excluded on later runs.

Move APIs, SSE replay frames, normal PGN export, tournament PGN export and signed audit exports
restore the retained records after pruning. Audit integrity verification hashes
the same normalized move records as the signed package, preserving telemetry,
move counts, final FEN and signatures across archival. A corrupt archive raises an
error instead of silently returning an empty replay.

From the repository root, with the normal backend database environment:

```sh
node backend/database/archiveMoves.js --dry-run --older-than-days 90 --batch-size 500
node backend/database/archiveMoves.js --older-than-days 90 --batch-size 500
```

The second command can be scheduled by an external job runner. It does not
require S3 and is separate from whole-game S3 archival and soft-delete retention.
Check the JSON counters (`candidates`, `processed`, `movesPruned`, `skipped`)
and job exit status. Keep normal database backups: a move archive lives in the
same database and is not a disaster-recovery backup.

The down migration refuses to remove populated archive columns. Restore move
rows from the retained blob before reverting the migration; do not drop the
columns while they hold the only copy.

Regression coverage is in `backend/tests/archivalService.test.js` and
`backend/tests/moveArchival.integration.test.js`. The partition workflow runs
the integration cases against its disposable PostgreSQL service, verifying
active/recent/disputed preservation, rollback, lock skipping, replay retention
and the down-migration guard. Local tests and migrations were not executed
under the static-only contribution workflow.
