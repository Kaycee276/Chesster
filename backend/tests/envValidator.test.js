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
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
    process.env.SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";

    expect(() => validateEnv({ skipExit: true })).not.toThrow();
  });

  it("throws error when DATABASE_URL is missing", () => {
    delete process.env.DATABASE_URL;
    process.env.SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";

    expect(() => validateEnv({ skipExit: true })).toThrow(/DATABASE_URL/);
  });

  it("throws error when SOROBAN_RPC_URL is missing", () => {
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
    delete process.env.SOROBAN_RPC_URL;
    delete process.env.STELLAR_RPC_URL;

    expect(() => validateEnv({ skipExit: true })).toThrow(/SOROBAN_RPC_URL/);
  });

  it("lists all required environment variables in REQUIRED_ENV_VARS array", () => {
    const keys = REQUIRED_ENV_VARS.map((v) => v.key);
    expect(keys).toContain("DATABASE_URL");
    expect(keys).toContain("SOROBAN_RPC_URL");
  });
});
