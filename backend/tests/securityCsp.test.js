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

describe("Content Security Policy & Strict Headers (Issue #325 & Issue #444)", () => {
  test("serves Content-Security-Policy header on / with restricted origins and WASM support", async () => {
    const res = await request(app).get("/");

    expect(res.status).toBe(200);
    const csp = res.headers["content-security-policy"];
    expect(csp).toBeDefined();

    // Default source must be 'self'
    expect(csp).toContain("default-src 'self'");
    // Object source must be 'none'
    expect(csp).toContain("object-src 'none'");
    // Scripts must include 'self' and 'wasm-unsafe-eval' for Stockfish engine
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("'wasm-unsafe-eval'");
    // Frame ancestors must be 'none' to prevent clickjacking
    expect(csp).toContain("frame-ancestors 'none'");
    // Connect sources must support Stellar Horizon and RPC nodes
    expect(csp).toContain("https://horizon.stellar.org");
    expect(csp).toContain("https://*.stellar.org");
    expect(csp).toContain("wss:");
    expect(csp).toContain("ws:");
  });

  test("serves Content-Security-Policy header on /api/health", async () => {
    const res = await request(app).get("/api/health");

    expect(res.status).toBe(200);
    const csp = res.headers["content-security-policy"];
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("'wasm-unsafe-eval'");
  });

  test("disallows unauthorized external scripts in CSP header", async () => {
    const res = await request(app).get("/health");
    const csp = res.headers["content-security-policy"];

    // Ensure external unverified CDNs (like cdnjs or unpkg) are not whitelisted
    expect(csp).not.toContain("https://cdnjs.cloudflare.com");
    expect(csp).not.toContain("https://unpkg.com");
  });
});
