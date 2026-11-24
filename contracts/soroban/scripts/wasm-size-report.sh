#!/usr/bin/env bash
set -euo pipefail

# Renders a markdown WASM size comparison for a pull request comment (issue #636).
#
# Usage: ./wasm-size-report.sh HEAD_JSON [BASE_JSON]
#   HEAD_JSON  metrics from check-wasm-size.sh (WASM_SIZE_JSON_OUT) for the PR head
#   BASE_JSON  metrics for the target branch; omit or point at a missing file when
#              no baseline is available (the report then shows head sizes only)
#
# The markdown is written to stdout and starts with a hidden marker so the workflow
# can find and update its previous comment instead of posting a new one each push.
# Warning thresholds can be tuned with WASM_GROWTH_WARN_PERCENT (default 5) and
# WASM_GROWTH_WARN_BYTES (default 2048).

if [ $# -lt 1 ] || [ ! -f "$1" ]; then
  echo "Usage: $0 HEAD_JSON [BASE_JSON]" >&2
  exit 1
fi

HEAD_JSON="$1"
BASE_JSON="${2:-}"
if [ -n "$BASE_JSON" ] && [ ! -f "$BASE_JSON" ]; then
  BASE_JSON=""
fi

HEAD_JSON="$HEAD_JSON" BASE_JSON="$BASE_JSON" \
GROWTH_PERCENT="${WASM_GROWTH_WARN_PERCENT:-5}" \
GROWTH_BYTES="${WASM_GROWTH_WARN_BYTES:-2048}" \
node --input-type=module -e '
import { readFileSync } from "node:fs";

const read = (p) => (p ? JSON.parse(readFileSync(p, "utf8")) : null);
const head = read(process.env.HEAD_JSON);
const base = read(process.env.BASE_JSON);
const warnPercent = Number(process.env.GROWTH_PERCENT);
const warnBytes = Number(process.env.GROWTH_BYTES);

const kb = (n) => `${(n / 1024).toFixed(2)} KB`;
const size = (n) => (n === null || n === undefined ? "n/a" : `${n.toLocaleString("en-US")} B (${kb(n)})`);
const signed = (n) => `${n > 0 ? "+" : n < 0 ? "-" : ""}${Math.abs(n).toLocaleString("en-US")} B`;
const pct = (delta, from) => (from > 0 ? `${delta > 0 ? "+" : delta < 0 ? "-" : ""}${Math.abs((delta / from) * 100).toFixed(2)}%` : "n/a");

const rows = [
  ["Raw WASM", "raw_bytes"],
  ["Optimized WASM", "optimized_bytes"],
  ["Effective size (checked against budget)", "effective_bytes"],
];

const lines = [];
lines.push("<!-- wasm-size-report -->");
lines.push("## Soroban WASM size report");
lines.push("");
if (base) {
  lines.push("| Metric | Base (target branch) | This PR | Change | Change % |");
  lines.push("| --- | ---: | ---: | ---: | ---: |");
} else {
  lines.push("| Metric | This PR |");
  lines.push("| --- | ---: |");
}
for (const [label, key] of rows) {
  const h = head[key];
  if (base) {
    const b = base[key];
    if (typeof h === "number" && typeof b === "number") {
      lines.push(`| ${label} | ${size(b)} | ${size(h)} | ${signed(h - b)} | ${pct(h - b, b)} |`);
    } else {
      lines.push(`| ${label} | ${size(b)} | ${size(h)} | n/a | n/a |`);
    }
  } else {
    lines.push(`| ${label} | ${size(h)} |`);
  }
}
const used = (head.effective_bytes / head.max_bytes) * 100;
const budgetText = `${size(head.max_bytes)}, ${used.toFixed(1)}% used`;
lines.push(base ? `| Budget | | ${budgetText} | | |` : `| Budget | ${budgetText} |`);
lines.push("");

const notes = [];
if (!head.within_budget) {
  notes.push(`**Over budget:** the effective size exceeds the ${kb(head.max_bytes)} limit by ${signed(head.effective_bytes - head.max_bytes)}.`);
}
if (base) {
  const delta = head.effective_bytes - base.effective_bytes;
  const percent = base.effective_bytes > 0 ? (delta / base.effective_bytes) * 100 : 0;
  if (delta > 0 && (percent >= warnPercent || delta >= warnBytes)) {
    notes.push(
      `**Binary growth:** effective size grew by ${signed(delta)} (${pct(delta, base.effective_bytes)}), at or above the warning threshold (${warnPercent}% or ${warnBytes} B). ` +
        "Check for new dependencies, large inlined data structures, or missing optimization flags (`opt-level = \"z\"`, `lto`, `strip`)."
    );
  } else if (delta < 0) {
    notes.push(`Binary shrank by ${signed(delta).replace("-", "")}.`);
  } else if (delta === 0) {
    notes.push("No change in effective size.");
  }
} else {
  notes.push("No baseline was available for the target branch, so no comparison is shown.");
}
if (head.within_budget && used >= 90) {
  notes.push(`Warning: the contract uses ${used.toFixed(1)}% of the size budget.`);
}
notes.forEach((n) => lines.push(`- ${n}`));
lines.push("");
lines.push("_Sizes come from `contracts/soroban/scripts/check-wasm-size.sh` after `make optimize`. The baseline is built from the PR target branch with the same toolchain._");
console.log(lines.join("\n"));
'
