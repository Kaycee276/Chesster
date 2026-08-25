const supabase = require("../config/supabase");

class CronService {
  constructor() {
    this.isRunning = false;
    this.cronIntervalMs = 60 * 60 * 1000;
    this.cleanupThresholdHours = 24;
    this.cronHandle = null;
  }

  async cleanupAbandonedLobbies() {
    try {
      const thresholdTime = new Date(Date.now() - this.cleanupThresholdHours * 60 * 60 * 1000).toISOString();

      const { data: expiredGames, error: fetchError } = await supabase
        .from("games")
        .select("id, game_code, created_at")
        .eq("status", "waiting")
        .lt("created_at", thresholdTime)
        .limit(100);

      if (fetchError) {
        console.error("[CronService] Error fetching expired games:", fetchError.message);
        return { success: false, error: fetchError.message };
      }

      if (!expiredGames || expiredGames.length === 0) {
        console.log("[CronService] No abandoned lobbies found to clean up");
        return { success: true, cleaned: 0 };
      }

      const gameIds = expiredGames.map(g => g.id);
      const { error: updateError } = await supabase
        .from("games")
        .update({ status: "expired" })
        .in("id", gameIds);

      if (updateError) {
        console.error("[CronService] Error marking games as expired:", updateError.message);
        return { success: false, error: updateError.message };
      }

      console.log(`[CronService] Successfully cleaned up ${expiredGames.length} abandoned lobbies (older than ${this.cleanupThresholdHours} hours)`);
      return { success: true, cleaned: expiredGames.length };
    } catch (error) {
      console.error("[CronService] Unexpected error during cleanup:", error.message);
      return { success: false, error: error.message };
    }
  }

  start() {
    if (this.isRunning) {
      console.log("[CronService] Cron job is already running");
      return;
    }

    this.isRunning = true;
    console.log(`[CronService] Starting automated cleanup cron (interval: ${this.cronIntervalMs / 1000 / 60} minutes)`);

    this.cleanupAbandonedLobbies();

    this.cronHandle = setInterval(() => {
      this.cleanupAbandonedLobbies();
    }, this.cronIntervalMs);
  }

  stop() {
    if (!this.isRunning) {
      console.log("[CronService] Cron job is not running");
      return;
    }

    if (this.cronHandle) {
      clearInterval(this.cronHandle);
      this.cronHandle = null;
    }

    this.isRunning = false;
    console.log("[CronService] Stopped automated cleanup cron");
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      intervalMs: this.cronIntervalMs,
      cleanupThresholdHours: this.cleanupThresholdHours,
    };
  }

  setCleanupInterval(intervalMs) {
    this.cronIntervalMs = intervalMs;
    if (this.isRunning) {
      this.stop();
      this.start();
    }
  }

  setCleanupThreshold(hours) {
    this.cleanupThresholdHours = hours;
  }
}

module.exports = new CronService();
