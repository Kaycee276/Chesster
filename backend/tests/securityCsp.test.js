// Keep route tests independent of the SDK's ESM-only transitive hash module.
jest.mock("@stellar/stellar-sdk", () => ({
  Networks: { TESTNET: "Test SDF Network ; September 2015" },
  rpc: { Server: jest.fn(() => ({ getLatestLedger: jest.fn().mockResolvedValue({ sequence: 1 }) })) },
  Keypair: { random: jest.fn(), fromPublicKey: jest.fn() },
  Contract: jest.fn(),
  TransactionBuilder: jest.fn(),
  xdr: {},
  scValToNative: jest.fn(),
  nativeToScVal: jest.fn(),
  BASE_FEE: "100",
}));

const request = require("supertest");
const { app } = require("../server");

describe("Content Security Policy & Third-Party Isolation (Issue #325)", () => {
  test("serves Content-Security-Policy header with restricted origins", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    const csp = res.headers["content-security-policy"];
    expect(csp).toBeDefined();

    // Default source must be 'self'
    expect(csp).toContain("default-src 'self'");
    // Object source must be 'none'
    expect(csp).toContain("object-src 'none'");
    // Scripts must include 'self'
    expect(csp).toContain("script-src 'self'");
  });

  test("disallows unauthorized external scripts in CSP header", async () => {
    const res = await request(app).get("/health");
    const csp = res.headers["content-security-policy"];

    // Ensure external unverified CDNs (like cdnjs or unpkg) are not whitelisted
    expect(csp).not.toContain("https://cdnjs.cloudflare.com");
    expect(csp).not.toContain("https://unpkg.com");
  });
});
