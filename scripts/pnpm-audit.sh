#!/usr/bin/env bash
set -euo pipefail

# Dependency vulnerability gate (issue #635).
#
# Audits the production dependencies of one pnpm project and fails when a high or
# critical advisory is found. Moderate and low findings are reported but do not
# fail the run. Advisories listed in .github/pnpm-audit-ignore.txt are skipped.
#
# The ignore list is applied here rather than with `pnpm audit --ignore`, because
# pnpm 10+ persists --ignore into the project's pnpm-workspace.yaml.
#
# Usage: scripts/pnpm-audit.sh [PROJECT_DIR]   (default: repository root)
# Env:   PNPM_AUDIT_IGNORE_FILE  alternative ignore list (default: .github/pnpm-audit-ignore.txt)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IGNORE_FILE="${PNPM_AUDIT_IGNORE_FILE:-$REPO_ROOT/.github/pnpm-audit-ignore.txt}"
PROJECT_DIR="${1:-$REPO_ROOT}"

if [ ! -f "$PROJECT_DIR/pnpm-lock.yaml" ]; then
  echo "Error: no pnpm-lock.yaml in '$PROJECT_DIR'" >&2
  exit 1
fi

REPORT="$(mktemp)"
trap 'rm -f "$REPORT"' EXIT

echo "Auditing production dependencies in: $PROJECT_DIR"
# pnpm exits non-zero when it finds vulnerabilities; the verdict is computed below.
(cd "$PROJECT_DIR" && pnpm audit --audit-level high --prod --json > "$REPORT") || true

IGNORE_FILE="$IGNORE_FILE" REPORT="$REPORT" node --input-type=module -e '
import { readFileSync, existsSync } from "node:fs";

const ignored = new Set();
const ignoreFile = process.env.IGNORE_FILE;
if (ignoreFile && existsSync(ignoreFile)) {
  for (const raw of readFileSync(ignoreFile, "utf8").split(/\r?\n/)) {
    const id = raw.split("#")[0].trim();
    if (!id) continue;
    if (!/^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/.test(id)) {
      console.error(`Error: invalid advisory ID "${id}" in ${ignoreFile}`);
      process.exit(2);
    }
    ignored.add(id);
  }
}

let report;
try {
  report = JSON.parse(readFileSync(process.env.REPORT, "utf8"));
} catch {
  console.error("Error: pnpm audit did not return a JSON report (registry or network failure?).");
  process.exit(2);
}
if (report.error) {
  console.error(`Error: pnpm audit failed: ${report.error.message || JSON.stringify(report.error)}`);
  process.exit(2);
}

const blocking = [];
const skipped = [];
const other = [];
for (const advisory of Object.values(report.advisories || {})) {
  const high = advisory.severity === "high" || advisory.severity === "critical";
  if (!high) other.push(advisory);
  else if (ignored.has(advisory.github_advisory_id)) skipped.push(advisory);
  else blocking.push(advisory);
}

const line = (a) =>
  `  ${a.severity.padEnd(8)} ${a.github_advisory_id}  ${a.module_name} ${a.vulnerable_versions} (patched: ${a.patched_versions})`;

if (other.length) console.log(`Below threshold (reported only): ${other.length} low/moderate advisories`);
if (skipped.length) {
  console.log(`Ignored via ${ignoreFile}: ${skipped.length}`);
  skipped.forEach((a) => console.log(line(a)));
}
if (blocking.length) {
  console.error(`FAIL: ${blocking.length} high/critical advisories not in the ignore list:`);
  blocking.forEach((a) => console.error(line(a)));
  process.exit(1);
}
console.log("PASS: no unignored high or critical advisories.");
'
