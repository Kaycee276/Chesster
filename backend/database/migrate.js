#!/usr/bin/env node

/**
 * Database Migration Runner with Rollback Support
 *
 * Usage:
 *   node migrate.js up          Apply all pending migrations
 *   node migrate.js down        Rollback the last applied migration
 *   node migrate.js down --all  Rollback all applied migrations
 *   node migrate.js status      Show migration status
 *
 * Environment Variables:
 *   DATABASE_URL  PostgreSQL connection string (required)
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function getClient() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });
  await client.connect();
  return client;
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      version VARCHAR(255) UNIQUE NOT NULL,
      filename VARCHAR(255) NOT NULL,
      applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      rolled_back_at TIMESTAMP WITH TIME ZONE
    );
  `);
}

function getMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    return [];
  }
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();
}

function parseMigrationVersion(filename) {
  const match = filename.match(/^(\d+)_/);
  return match ? match[1] : filename.replace('.sql', '');
}

async function getAppliedMigrations(client) {
  const result = await client.query(
    'SELECT version, filename, applied_at FROM schema_migrations WHERE rolled_back_at IS NULL ORDER BY version'
  );
  return result.rows;
}

async function getRollbackFile(filename) {
  const migrationPath = path.join(MIGRATIONS_DIR, filename);
  const content = fs.readFileSync(migrationPath, 'utf8');

  // Look for a DOWN section in the migration file
  const downMatch = content.match(/--\s*DOWN[\s\S]*?(?=--\s*[A-Z]|$)/i);
  if (downMatch) {
    return downMatch[0]
      .replace(/--\s*DOWN[\s\S]*/i, '')
      .replace(/^--.*$/gm, '')
      .trim();
  }

  return null;
}

async function applyMigration(client, filename) {
  const migrationPath = path.join(MIGRATIONS_DIR, filename);
  const content = fs.readFileSync(migrationPath, 'utf8');
  const version = parseMigrationVersion(filename);

  // Extract only the UP section (everything before DOWN if present)
  let upContent = content;
  const downIdx = content.search(/--\s*DOWN[\s\S]*/i);
  if (downIdx !== -1) {
    upContent = content.substring(0, downIdx);
  }

  console.log(`  Applying: ${filename}`);
  await client.query('BEGIN');
  try {
    await client.query(upContent);
    await client.query(
      'INSERT INTO schema_migrations (version, filename) VALUES ($1, $2)',
      [version, filename]
    );
    await client.query('COMMIT');
    console.log(`  ✓ Applied: ${filename}`);
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`  ✗ Failed: ${filename}`);
    console.error(`    ${err.message}`);
    return false;
  }
}

async function rollbackMigration(client, filename) {
  const version = parseMigrationVersion(filename);
  const migrationPath = path.join(MIGRATIONS_DIR, filename);
  const content = fs.readFileSync(migrationPath, 'utf8');

  // Extract the DOWN section
  const downMatch = content.match(/--\s*DOWN([\s\S]*?)(?=--\s*[A-Z]|$)/i);
  if (!downMatch || !downMatch[1].trim()) {
    console.log(`  ⚠ No rollback defined for: ${filename}`);
    return true;
  }

  const downContent = downMatch[1]
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n')
    .trim();

  if (!downContent) {
    console.log(`  ⚠ No rollback defined for: ${filename}`);
    return true;
  }

  console.log(`  Rolling back: ${filename}`);
  await client.query('BEGIN');
  try {
    await client.query(downContent);
    await client.query(
      'UPDATE schema_migrations SET rolled_back_at = NOW() WHERE version = $1',
      [version]
    );
    await client.query('COMMIT');
    console.log(`  ✓ Rolled back: ${filename}`);
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`  ✗ Rollback failed: ${filename}`);
    console.error(`    ${err.message}`);
    return false;
  }
}

async function migrateUp() {
  const client = await getClient();
  try {
    await ensureMigrationsTable(client);

    const migrationFiles = getMigrationFiles();
    const applied = await getAppliedMigrations(client);
    const appliedVersions = new Set(applied.map(m => m.version));

    const pending = migrationFiles.filter(f => {
      const version = parseMigrationVersion(f);
      return !appliedVersions.has(version);
    });

    if (pending.length === 0) {
      console.log('No pending migrations.');
      return;
    }

    console.log(`Found ${pending.length} pending migration(s):`);
    for (const file of pending) {
      const success = await applyMigration(client, file);
      if (!success) {
        console.error('Migration failed. Stopping.');
        process.exit(1);
      }
    }

    console.log('All migrations applied successfully.');
  } finally {
    await client.end();
  }
}

async function migrateDown(all = false) {
  const client = await getClient();
  try {
    await ensureMigrationsTable(client);

    const applied = await getAppliedMigrations(client);
    if (applied.length === 0) {
      console.log('No migrations to rollback.');
      return;
    }

    const toRollback = all ? [...applied].reverse() : [applied[applied.length - 1]];

    console.log(`Rolling back ${toRollback.length} migration(s):`);
    for (const migration of toRollback) {
      const success = await rollbackMigration(client, migration.filename);
      if (!success) {
        console.error('Rollback failed. Stopping.');
        process.exit(1);
      }
    }

    console.log('Rollback complete.');
  } finally {
    await client.end();
  }
}

async function migrateStatus() {
  const client = await getClient();
  try {
    await ensureMigrationsTable(client);

    const migrationFiles = getMigrationFiles();
    const applied = await getAppliedMigrations(client);
    const appliedMap = new Map(applied.map(m => [m.version, m]));

    console.log('Migration Status:');
    console.log('─'.repeat(60));

    if (migrationFiles.length === 0) {
      console.log('  No migration files found.');
      return;
    }

    for (const file of migrationFiles) {
      const version = parseMigrationVersion(file);
      const record = appliedMap.get(version);
      if (record) {
        console.log(`  ✓ ${file} (applied: ${record.applied_at.toISOString()})`);
      } else {
        console.log(`  ○ ${file} (pending)`);
      }
    }
  } finally {
    await client.end();
  }
}

// CLI
const args = process.argv.slice(2);
const command = args[0];

(async () => {
  switch (command) {
    case 'up':
      await migrateUp();
      break;
    case 'down':
      await migrateDown(args.includes('--all'));
      break;
    case 'status':
      await migrateStatus();
      break;
    default:
      console.log('Usage: node migrate.js <up|down|status>');
      console.log('');
      console.log('Commands:');
      console.log('  up          Apply all pending migrations');
      console.log('  down        Rollback the last applied migration');
      console.log('  down --all  Rollback all applied migrations');
      console.log('  status      Show migration status');
      process.exit(1);
  }
})().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
