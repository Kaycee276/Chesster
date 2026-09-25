const { Readable } = require("stream");
const zlib = require("zlib");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const supabase = require("../config/supabase");

const ARCHIVE_BATCH_SIZE = 5000;

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
    const { data: games, error: gamesError } = await this.client
      .from("games")
      .select("*")
      .in("status", ["finished", "completed"])
      .lt("updated_at", cutoffDate.toISOString())
      .order("updated_at", { ascending: true })
      .limit(limit);

    if (gamesError) throw gamesError;
    if (!games?.length) return [];

    const gameIds = games.map((game) => game.id);
    const gameCodes = games.map((game) => game.game_code);
    const [movesResult, auditResult, chatResult] = await Promise.all([
      this.client.from("moves").select("*").in("game_id", gameIds).order("move_number"),
      this.client.from("match_audit_logs").select("*").in("game_id", gameIds).order("created_at"),
      this.client.from("chat_messages").select("*").in("game_code", gameCodes).order("created_at"),
    ]);

    for (const result of [movesResult, auditResult, chatResult]) {
      if (result.error) throw result.error;
    }

    return games.map((game) => ({
      ...game,
      moves: (movesResult.data || []).filter((move) => move.game_id === game.id),
      auditLogs: (auditResult.data || []).filter((entry) => entry.game_id === game.id),
      chatMessages: (chatResult.data || []).filter((message) => message.game_code === game.game_code),
    }));
  }

  async purge(gameIds) {
    const { data, error } = await this.client.rpc("purge_archived_games", {
      p_game_ids: gameIds,
    });
    if (error) throw error;
    return data;
  }
}

class ArchivalService {
  constructor({ repository, s3Client, now } = {}) {
    this.repository = repository || new SupabaseArchiveRepository();
    this.s3Client = s3Client || null;
    this.now = now || (() => new Date());
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

      const purged = await this.repository.purge(games.map((game) => game.id));
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
}

module.exports = new ArchivalService();
module.exports.ArchivalService = ArchivalService;
module.exports.SupabaseArchiveRepository = SupabaseArchiveRepository;
module.exports.ARCHIVE_BATCH_SIZE = ARCHIVE_BATCH_SIZE;
module.exports.gzipJson = gzipJson;
