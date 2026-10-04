/**
 * Compatibility alias: redirects legacy Supabase imports to the direct PostgreSQL / Neon
 * connection pool and Prisma ORM client (config/db.js).
 *
 * This allows all existing service queries to run against Neon without requiring
 * @supabase/supabase-js or proprietary PostgREST HTTP dependencies.
 */

const db = require("./db");

module.exports = db;
