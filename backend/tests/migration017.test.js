const fs = require("node:fs");
const path = require("node:path");

const migration = fs.readFileSync(
  path.join(__dirname, "../database/migrations/017_add_composite_game_indexes.sql"),
  "utf8"
);

describe("Migration 017 composite game indexes", () => {
  it("defines the player history and status indexes on the query columns", () => {
    expect(migration).toMatch(
      /idx_games_white_player_created_at[\s\S]*player_white_address, created_at DESC/
    );
    expect(migration).toMatch(
      /idx_games_black_player_created_at[\s\S]*player_black_address, created_at DESC/
    );
    expect(migration).toMatch(/idx_games_status_created_at[\s\S]*status, created_at DESC/);
  });

  it("provides idempotent creation and rollback statements", () => {
    expect(migration.match(/CREATE INDEX IF NOT EXISTS/g)).toHaveLength(3);
    expect(migration.match(/DROP INDEX IF EXISTS/g)).toHaveLength(3);
  });
});
