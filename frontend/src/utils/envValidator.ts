/**
 * Frontend Environment Variable Validator Script (#10)
 * Validates Vite environment variables on app initialization.
 */

export interface RequiredFrontendEnv {
  key: string;
  description: string;
}

export const REQUIRED_FRONTEND_VARS: RequiredFrontendEnv[] = [
  { key: "VITE_BACKEND_URL", description: "Backend Express Server API Endpoint URL" },
  { key: "VITE_CONTRACT_ID", description: "Soroban Escrow Smart Contract Address" },
];

/**
 * Validates frontend Vite environment variables.
 * Logs developer warnings to console if environment variables are missing.
 *
 * @returns {boolean} True if all variables are present, false if any are missing.
 */
export function validateFrontendEnv(): boolean {
  const missing: RequiredFrontendEnv[] = [];

  for (const envVar of REQUIRED_FRONTEND_VARS) {
    const value = import.meta.env[envVar.key];
    if (!value || String(value).trim() === "") {
      missing.push(envVar);
    }
  }

  if (missing.length > 0) {
    console.warn(
      `[EnvValidator Warning] Missing frontend environment variable(s):\n${missing
        .map((m) => `  - ${m.key}: ${m.description}`)
        .join("\n")}\nPlease create or update frontend/.env with required values.`
    );
    return false;
  }

  return true;
}
