const logger = require("../utils/logger");

const REQUIRED_ENV_VARS = [
  { key: "SUPABASE_URL", description: "Supabase Project URL" },
  { key: "SUPABASE_KEY", description: "Supabase Service/Anon Key" },
  { key: "SOROBAN_RPC_URL", description: "Soroban RPC Endpoint URL" },
];

/**
 * Validates backend environment variables.
 * Logs a formatted error and exits process with code 1 if critical keys are missing.
 *
 * @param {Object} [options]
 * @param {boolean} [options.skipExit=false] - If true, throws Error instead of process.exit(1) (useful for testing)
 */
function validateEnv(options = {}) {
  const missingKeys = [];

  for (const envVar of REQUIRED_ENV_VARS) {
    const value = process.env[envVar.key];
    if (!value || String(value).trim() === "") {
      missingKeys.push(envVar);
    }
  }

  if (missingKeys.length > 0) {
    const errorMessage = `CRITICAL CONFIGURATION ERROR: Missing required environment variable(s):\n${missingKeys
      .map((k) => `  - ${k.key} (${k.description})`)
      .join("\n")}\nPlease check your .env configuration file before starting the server.`;

    if (logger && typeof logger.error === "function") {
      logger.error(errorMessage);
    } else {
      console.error(errorMessage);
    }

    if (options.skipExit || process.env.NODE_ENV === "test") {
      throw new Error(`Environment Validation Failed: ${missingKeys.map((k) => k.key).join(", ")}`);
    }

    process.exit(1);
  }

  return true;
}

module.exports = {
  validateEnv,
  REQUIRED_ENV_VARS,
};
