const { Readable } = require("stream");
const zlib = require("zlib");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const supabase = require("../config/supabase");

const ARCHIVE_BATCH_SIZE = 5000;

const { prepareMoveArchive, restoreArchivedMoves } = require("./moveArchive");

const MOVE_ARCHIVE_ELIGIBILITY = `g.status IN ('finished', 'completed')
  AND COALESCE(g.ended_at, g.updated_at) < $1 AND g.updated_at < $1
  AND g.deleted_at IS NULL AND g.moves_archived_at IS NULL
  AND NOT COALESCE(g.cheat_flagged, false)
  AND NOT EXISTS (SELECT 1 FROM public.player_flags f WHERE f.game_id = g.id AND f.status = 'pending')
  AND EXISTS (SELECT 1 FROM public.moves m WHERE m.game_id = g.id)`;

function gzipJson(value) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const gzip = zlib.createGzip();
    gzip.on("data", (chunk) => chunks.push(chunk));
    gzip.on("end", () => resolve(Buffer.concat(chunks)));
    gzip.on("error", reject);
    Readable.from([JSON.stringify(value)]).pipe(gzip);
  });
}

class SupabaseArchiveRepository {
  constructor(client = supabase) {
    this.client = client;
  }

  async fetchBatch(cutoffDate, limit = ARCHIVE_BATCH_SIZE) {
    let gamesQuery = this.client
      .from("games")
      .select("*")
      .in("status", ["finished", "completed"])
      .lt("updated_at", cutoffDate.toISOString())
      .order("updated_at", { ascending: true })
      .limit(limit);
    // Soft-delete / retention filters (#471): never archive deleted or
    // already-archived rows. Guarded for query-builder compat in tests.
    if (gamesQuery && typeof gamesQuery.is === "function") {
      gamesQuery = gamesQuery.is("deleted_at", null);
    }
    if (gamesQuery && typeof gamesQuery.eq === "function") {
      gamesQuery = gamesQuery.eq("is_archived", false);
    }

    const { data: games, error: gamesError } = await gamesQuery;

    if (gamesError) throw gamesError;
    if (!games?.length) return [];

    // Never archive soft-deleted / already-archived rows even if the
    // underlying store lacks the columns (defensive JS filter).
    const eligible = games.filter((g) => !g.deleted_at && !g.is_archived);
    if (!eligible.length) return [];

    // Never archive games with open disputes / cheat flags under review.
    let disputableIds = new Set();
    try {
      const flagQuery = this.client.from("player_flags").select("game_id").eq("status", "pending");
      const flagResult = await flagQuery;
      const flags = flagResult?.data || [];
      disputableIds = new Set(flags.map((f) => f.game_id));
    } catch (_) {
      // If flags table is unavailable, proceed without dispute exclusion.
    }
    const archivable = eligible.filter((g) => !disputableIds.has(g.id));
    if (!archivable.length) return [];

    const gameIds = archivable.map((game) => game.id);
    const gameCodes = archivable.map((game) => game.game_code);
    const [movesResult, auditResult, chatResult] = await Promise.all([
      this.client.from("moves").select("*").in("game_id", gameIds).order("move_number"),
      this.client.from("match_audit_logs").select("*").in("game_id", gameIds).order("created_at"),
      this.client.from("chat_messages").select("*").in("game_code", gameCodes).order("created_at"),
    ]);

    for (const result of [movesResult, auditResult, chatResult]) {
      if (result.error) throw result.error;
    }

    return archivable.map((game) => ({
      ...game,
      moves: (movesResult.data || []).filter((move) => move.game_id === game.id),
      auditLogs: (auditResult.data || []).filter((entry) => entry.game_id === game.id),
      chatMessages: (chatResult.data || []).filter((message) => message.game_code === game.game_code),
    }));
  }

  async purge(gameIds, cutoffDate) {
    const { data, error } = await this.client.rpc("purge_archived_games", {
      p_game_ids: gameIds,
      p_cutoff_date: cutoffDate.toISOString(),
    });
    if (error) throw error;
    return data;
  }
}

class ArchivalService {
  constructor({ repository, s3Client, now, db = supabase } = {}) {
    this.repository = repository || new SupabaseArchiveRepository();
    this.s3Client = s3Client || null;
    this.now = now || (() => new Date());
    this.db = db;
  }

  /** Provision current + two upcoming UTC months, including December rollover. */
  async ensureMonthlyPartitionsExist(referenceDate = this.now()) {
    if (!(referenceDate instanceof Date) || Number.isNaN(referenceDate.valueOf())) {
      throw new Error("A valid partition reference date is required");
    }
    const client = await this.db.getPool().connect();
    const partitions = [];
    try {
      await client.query("BEGIN");
      // Serialize maintenance across backend instances on one transaction lock.
      await client.query("SELECT pg_advisory_xact_lock(652, 1)");
      const { rows } = await client.query(
        "SELECT 1 FROM pg_partitioned_table WHERE partrelid = 'public.moves'::regclass",
      );
      if (!rows.length) throw new Error("Apply moves partition migration 031 before provisioning partitions");

      for (let offset = 0; offset <= 2; offset += 1) {
        const start = new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth() + offset, 1));
        const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
        const name = `moves_${start.getUTCFullYear()}_${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
        const existing = await client.query(
          "SELECT 1 FROM pg_inherits WHERE inhparent = 'public.moves'::regclass AND inhrelid = to_regclass($1)",
          [`public.${name}`],
        );
        if (!existing.rows.length) {
          // Lock writes while draining the fallback, then attach atomically.
          // Bounds and identifiers come only from validated UTC dates.
          await client.query("LOCK TABLE public.moves IN ACCESS EXCLUSIVE MODE");
          await client.query(`CREATE TABLE public."${name}" (LIKE public.moves INCLUDING ALL)`);
          await client.query(`ALTER TABLE public."${name}" ENABLE ROW LEVEL SECURITY`);
          await client.query(
            `WITH relocated AS (DELETE FROM public.moves_default WHERE created_at >= $1 AND created_at < $2 RETURNING *)
             INSERT INTO public."${name}" SELECT * FROM relocated`,
            [start.toISOString(), end.toISOString()],
          );
          await client.query(
            `ALTER TABLE public.moves ATTACH PARTITION public."${name}"
             FOR VALUES FROM ('${start.toISOString()}') TO ('${end.toISOString()}')`,
          );
        }
        partitions.push(name);
      }
      await client.query("COMMIT");
      return { success: true, partitions };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /** Preserve move rows on the parent before pruning old terminal games. */
  async archiveOldGameMoves({ olderThanDays = 90, batchSize = 500, dryRun = false } = {}) {
    if (!Number.isInteger(olderThanDays) || olderThanDays < 1 || olderThanDays > 36500) {
      throw new Error("olderThanDays must be an integer from 1 to 36500");
    }
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 5000) {
      throw new Error("batchSize must be an integer from 1 to 5000");
    }
    if (typeof dryRun !== "boolean") throw new Error("dryRun must be a boolean");
    const now = this.now();
    if (!(now instanceof Date) || Number.isNaN(now.valueOf())) throw new Error("A valid archival reference date is required");
    const cutoff = new Date(now.valueOf() - olderThanDays * 86400000);
    const pool = this.db.getPool();
    const { rows } = await pool.query(
      `SELECT g.* FROM public.games g WHERE ${MOVE_ARCHIVE_ELIGIBILITY}
       ORDER BY COALESCE(g.ended_at, g.updated_at), g.id LIMIT $2`,
      [cutoff.toISOString(), batchSize],
    );
    if (dryRun) return { candidates: rows.length, processed: 0, movesPruned: 0, skipped: 0, dryRun, gameIds: rows.map((game) => game.id) };
    let processed = 0;
    let movesPruned = 0;
    let skipped = 0;
    for (const candidate of rows) {
      const result = await this.archiveMoveGame(pool, candidate.id, cutoff, now);
      processed += result.processed;
      movesPruned += result.movesPruned;
      skipped += result.skipped;
    }
    return { candidates: rows.length, processed, movesPruned, skipped, dryRun };
  }

  async archiveMoveGame(pool, gameId, cutoff, archivedAt) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '2s'");
      await client.query("SET LOCAL statement_timeout = '15s'");
      // The parent FOR UPDATE lock also blocks new FK-linked move inserts.
      const { rows: games } = await client.query(
        `SELECT g.* FROM public.games g WHERE g.id = $2 AND ${MOVE_ARCHIVE_ELIGIBILITY}
         FOR UPDATE OF g SKIP LOCKED`,
        [cutoff.toISOString(), gameId],
      );
      if (!games.length) {
        await client.query("COMMIT");
        return { processed: 0, movesPruned: 0, skipped: 1 };
      }
      const game = games[0];
      const { rows: moves } = await client.query(
        "SELECT * FROM public.moves WHERE game_id = $1 ORDER BY move_number FOR UPDATE",
        [gameId],
      );
      const archive = await prepareMoveArchive(game, moves);
      if (!archive) {
        await client.query("COMMIT");
        return { processed: 0, movesPruned: 0, skipped: 1 };
      }
      const saved = await client.query(
        "UPDATE public.games SET pgn = $2, move_archive = $3, moves_archived_at = $4 WHERE id = $1 RETURNING *",
        [gameId, archive.pgn, archive.moveArchive, archivedAt.toISOString()],
      );
      if (saved.rows.length !== 1 || saved.rows[0].pgn !== archive.pgn ||
          JSON.stringify(restoreArchivedMoves(saved.rows[0], [])) !== JSON.stringify(moves)) throw new Error("Move archive read-back verification failed");
      const deleted = await client.query("DELETE FROM public.moves WHERE game_id = $1", [gameId]);
      if (deleted.rowCount !== moves.length) throw new Error("Move count changed during archival");
      await client.query("COMMIT");
      return { processed: 1, movesPruned: deleted.rowCount, skipped: 0 };
    } catch (error) {
      try { await client.query("ROLLBACK"); }
      catch (rollbackError) { throw new AggregateError([error, rollbackError], "Move archival and rollback failed"); }
      throw error;
    } finally {
      client.release();
    }
  }

  getS3Client() {
    if (this.s3Client) return this.s3Client;
    const config = { region: process.env.AWS_REGION || "us-east-1" };
    if (process.env.ARCHIVE_S3_ENDPOINT) {
      config.endpoint = process.env.ARCHIVE_S3_ENDPOINT;
      config.forcePathStyle = true;
    }
    this.s3Client = new S3Client(config);
    return this.s3Client;
  }

  async archiveOldGames(cutoffDate) {
    if (!(cutoffDate instanceof Date) || Number.isNaN(cutoffDate.valueOf())) {
      throw new Error("A valid archival cutoff date is required");
    }

    const bucket = process.env.ARCHIVE_S3_BUCKET;
    if (!bucket) throw new Error("ARCHIVE_S3_BUCKET is required");

    let archived = 0;
    let batchNumber = 0;
    const archives = [];

    while (true) {
      const games = await this.repository.fetchBatch(cutoffDate, ARCHIVE_BATCH_SIZE);
      if (games.length === 0) break;

      const generatedAt = this.now();
      const year = String(generatedAt.getUTCFullYear());
      const month = String(generatedAt.getUTCMonth() + 1).padStart(2, "0");
      const key = `games/${year}/${month}/games-${generatedAt.getTime()}-${batchNumber}.json.gz`;
      const body = await gzipJson({
        schemaVersion: 1,
        generatedAt: generatedAt.toISOString(),
        cutoffDate: cutoffDate.toISOString(),
        games,
      });

      await this.getS3Client().send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: "application/json",
        ContentEncoding: "gzip",
      }));

      const purged = await this.repository.purge(
        games.map((game) => game.id),
        cutoffDate,
      );
      if (purged !== games.length) {
        throw new Error(`Archived ${games.length} games but purged ${purged}`);
      }
      archived += games.length;
      archives.push({ key, records: games.length, bytes: body.length });
      batchNumber += 1;

      if (games.length < ARCHIVE_BATCH_SIZE) break;
    }

    return { success: true, archived, archives };
  }

  async purgeExpiredSoftDeletedGames(retentionDays = 90, batchSize = 500) {
    if (!(retentionDays > 0)) throw new Error("Retention days must be positive");
    if (!(batchSize > 0)) throw new Error("Batch size must be positive");

    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const cutoffISOString = cutoffDate.toISOString();
    let totalDeleted = 0;

    while (true) {
      const expiredGames = await this.db.from("games")
        .select("id")
        .not("deleted_at", "is", null)
        .lt("deleted_at", cutoffISOString)
        .limit(batchSize);

      if (expiredGames.error) throw expiredGames.error;
      if (!expiredGames.data?.length) break;

      const gameIds = expiredGames.data.map((g) => g.id);

      if (this.db.prisma && this.db.prisma.$transaction) {
        await this.db.prisma.$transaction([
          this.db.prisma.move.deleteMany({ where: { game_id: { in: gameIds } } }),
          this.db.prisma.matchAuditLog.deleteMany({ where: { game_id: { in: gameIds } } }),
          this.db.prisma.game.deleteMany({ where: { id: { in: gameIds } } }),
        ]);
      }

      totalDeleted += gameIds.length;
      if (gameIds.length < batchSize) break;
    }

    return totalDeleted;
  }
}

module.exports = new ArchivalService();
module.exports.ArchivalService = ArchivalService;
module.exports.SupabaseArchiveRepository = SupabaseArchiveRepository;
module.exports.ARCHIVE_BATCH_SIZE = ARCHIVE_BATCH_SIZE;
module.exports.gzipJson = gzipJson;
