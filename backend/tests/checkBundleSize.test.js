/**
 * Automated tests for frontend bundle size budget gate (Issue #544)
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { execSync, spawnSync } = require("child_process");

describe("Bundle Size Budget Enforcement (Issue #544)", () => {
  const repoRoot = path.resolve(__dirname, "../..");
  const frontendDir = path.join(repoRoot, "frontend");
  const scriptPath = path.join(frontendDir, "scripts/check-bundle-size.mjs");
  const tempDistDir = path.join(frontendDir, "dist");
  const tempAssetsDir = path.join(tempDistDir, "assets");

  beforeEach(() => {
    // Clean up dist directory before each test
    if (fs.existsSync(tempDistDir)) {
      fs.rmSync(tempDistDir, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    // Clean up dist directory after tests
    if (fs.existsSync(tempDistDir)) {
      fs.rmSync(tempDistDir, { recursive: true, force: true });
    }
  });

  test("fails cleanly with exit code 1 when assets directory is missing", () => {
    const result = spawnSync("node", [scriptPath], {
      cwd: frontendDir,
      encoding: "utf-8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Assets directory not found");
  });

  test("passes with exit code 0 when all chunks and total bundle are within budgets", () => {
    fs.mkdirSync(tempAssetsDir, { recursive: true });

    // Create a mock vendor chunk (~100 KB uncompressed, ~2 KB gzipped, well under 150 KB limit)
    fs.writeFileSync(
      path.join(tempAssetsDir, "vendor-abc12345.js"),
      "console.log('vendor chunk');\n".repeat(1000)
    );

    // Create a mock stellar chunk (~50 KB uncompressed, well under 200 KB limit)
    fs.writeFileSync(
      path.join(tempAssetsDir, "stellar-xyz98765.js"),
      "console.log('stellar chunk');\n".repeat(500)
    );

    // Create a css file
    fs.writeFileSync(
      path.join(tempAssetsDir, "index-def456.css"),
      "body { margin: 0; }\n".repeat(100)
    );

    const result = spawnSync("node", [scriptPath], {
      cwd: frontendDir,
      encoding: "utf-8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("All bundle size budgets passed.");
  });

  test("fails with exit code 1 when vendor chunk exceeds its budget (vendor > 150 KB)", () => {
    fs.mkdirSync(tempAssetsDir, { recursive: true });

    // Generate random binary data that cannot be compressed below 160 KB
    // Random bytes compress very poorly with gzip
    const uncompressibleData = require("crypto").randomBytes(165 * 1024);
    fs.writeFileSync(path.join(tempAssetsDir, "vendor-huge.js"), uncompressibleData);

    const result = spawnSync("node", [scriptPath], {
      cwd: frontendDir,
      encoding: "utf-8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Budget exceeded for vendor-huge.js");
  });

  test("fails with exit code 1 when stellar chunk exceeds its budget (stellar > 200 KB)", () => {
    fs.mkdirSync(tempAssetsDir, { recursive: true });

    // Generate random uncompressible binary data > 210 KB
    const uncompressibleData = require("crypto").randomBytes(215 * 1024);
    fs.writeFileSync(path.join(tempAssetsDir, "stellar-huge.js"), uncompressibleData);

    const result = spawnSync("node", [scriptPath], {
      cwd: frontendDir,
      encoding: "utf-8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Budget exceeded for stellar-huge.js");
  });

  test("fails with exit code 1 when total bundle exceeds total budget (> 1500 KB)", () => {
    fs.mkdirSync(tempAssetsDir, { recursive: true });

    // Generate 4 chunks that each pass per-chunk budgets (< 400 KB) but together exceed 1500 KB
    const data1 = require("crypto").randomBytes(390 * 1024);
    const data2 = require("crypto").randomBytes(390 * 1024);
    const data3 = require("crypto").randomBytes(390 * 1024);
    const data4 = require("crypto").randomBytes(390 * 1024);

    fs.writeFileSync(path.join(tempAssetsDir, "chunk-1.js"), data1);
    fs.writeFileSync(path.join(tempAssetsDir, "chunk-2.js"), data2);
    fs.writeFileSync(path.join(tempAssetsDir, "chunk-3.js"), data3);
    fs.writeFileSync(path.join(tempAssetsDir, "chunk-4.js"), data4);

    const result = spawnSync("node", [scriptPath], {
      cwd: frontendDir,
      encoding: "utf-8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Total bundle budget exceeded");
  });
});
