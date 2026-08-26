const { validateEnv, REQUIRED_ENV_VARS } = require("../config/envValidator");

describe("Backend Environment Validator (envValidator)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("passes validation when all required environment variables are set", () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_KEY = "test-key-123";
    process.env.SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";

    expect(() => validateEnv({ skipExit: true })).not.toThrow();
  });

  it("throws error when SUPABASE_URL is missing", () => {
    delete process.env.SUPABASE_URL;
    process.env.SUPABASE_KEY = "test-key-123";
    process.env.SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";

    expect(() => validateEnv({ skipExit: true })).toThrow(/SUPABASE_URL/);
  });

  it("throws error when SUPABASE_KEY is missing", () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    delete process.env.SUPABASE_KEY;
    process.env.SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";

    expect(() => validateEnv({ skipExit: true })).toThrow(/SUPABASE_KEY/);
  });

  it("throws error when SOROBAN_RPC_URL is missing", () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_KEY = "test-key-123";
    delete process.env.SOROBAN_RPC_URL;

    expect(() => validateEnv({ skipExit: true })).toThrow(/SOROBAN_RPC_URL/);
  });

  it("lists all required environment variables in REQUIRED_ENV_VARS array", () => {
    const keys = REQUIRED_ENV_VARS.map((v) => v.key);
    expect(keys).toContain("SUPABASE_URL");
    expect(keys).toContain("SUPABASE_KEY");
    expect(keys).toContain("SOROBAN_RPC_URL");
  });
});
