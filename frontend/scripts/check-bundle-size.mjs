import { readFile, readdir } from "node:fs/promises";
import { gzip as gzipBuffer } from "node:zlib";
import { promisify } from "node:util";
import path from "node:path";

const gzip = promisify(gzipBuffer);

// Per-chunk budgets (in bytes) based on production thresholds
const CHUNK_BUDGETS = {
  vendor: 150 * 1024,      // 150 KB gzip budget
  stellar: 200 * 1024,     // 200 KB gzip budget
  "wallet-connect": 400 * 1024, // 400 KB gzip budget
};

// Global total bundle budget (in bytes)
const TOTAL_BUDGET = 1500 * 1024; // 1.5 MB gzip budget for all chunks combined

const assetsDirectory = path.resolve("dist/assets");

async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const fullPath = path.join(directory, entry.name);
      return entry.isDirectory() ? filesIn(fullPath) : [fullPath];
    }),
  );
  return nested.flat();
}

const assets = (await filesIn(assetsDirectory)).filter((file) =>
  /\.(?:js|css)$/.test(file),
);

let totalGzipBytes = 0;
let hasExceededBudget = false;

for (const asset of assets) {
  const source = await readFile(asset);
  const compressed = await gzip(source);
  const size = compressed.length;
  totalGzipBytes += size;
  const fileName = path.basename(asset);
  const sizeKb = (size / 1024).toFixed(2);

  // Check specific chunk budget if applicable
  let chunkBudgetExceeded = false;
  for (const [prefix, budgetLimit] of Object.entries(CHUNK_BUDGETS)) {
    if (fileName.startsWith(prefix) && size > budgetLimit) {
      console.error(
        `❌ Budget exceeded for ${fileName}: ${sizeKb} KB gzip (budget: ${(budgetLimit / 1024).toFixed(0)} KB)`
      );
      chunkBudgetExceeded = true;
      hasExceededBudget = true;
    }
  }

  if (!chunkBudgetExceeded) {
    console.log(`${path.relative("dist", asset)}: ${sizeKb} KB gzip`);
  }
}

console.log(
  `\nTotal JavaScript/CSS bundle: ${(totalGzipBytes / 1024).toFixed(2)} KB gzip (budget: ${(TOTAL_BUDGET / 1024).toFixed(0)} KB)`
);

if (totalGzipBytes > TOTAL_BUDGET) {
  console.error(`❌ Total bundle budget exceeded: ${(totalGzipBytes / 1024).toFixed(2)} KB > ${(TOTAL_BUDGET / 1024).toFixed(0)} KB`);
  hasExceededBudget = true;
}

if (hasExceededBudget) {
  process.exit(1);
} else {
  console.log("✅ All bundle size budgets passed.");
}
