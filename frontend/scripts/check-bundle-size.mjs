import { readFile, readdir } from "node:fs/promises";
import { gzip as gzipBuffer } from "node:zlib";
import { promisify } from "node:util";
import path from "node:path";

const gzip = promisify(gzipBuffer);
const budget = 500 * 1024;
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

for (const asset of assets) {
  const source = await readFile(asset);
  const compressed = await gzip(source);
  totalGzipBytes += compressed.length;
  console.log(`${path.relative("dist", asset)}: ${(compressed.length / 1024).toFixed(2)} KB gzip`);
}

console.log(`Total JavaScript/CSS bundle: ${(totalGzipBytes / 1024).toFixed(2)} KB gzip (budget: 500 KB)`);
if (totalGzipBytes > budget) {
  console.error("Bundle size budget exceeded.");
  process.exit(1);
}
