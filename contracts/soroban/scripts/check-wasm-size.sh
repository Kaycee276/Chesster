#!/usr/bin/env bash
set -euo pipefail

# WASM Budget Limit in Bytes (64 KB = 65536 bytes)
MAX_SIZE_BYTES=65536

if [ -n "${1:-}" ]; then
  WASM_FILE="$1"
elif [ -f "target/wasm32-unknown-unknown/release/escrow.wasm" ]; then
  WASM_FILE="target/wasm32-unknown-unknown/release/escrow.wasm"
elif [ -f "contracts/soroban/target/wasm32-unknown-unknown/release/escrow.wasm" ]; then
  WASM_FILE="contracts/soroban/target/wasm32-unknown-unknown/release/escrow.wasm"
else
  WASM_FILE="target/wasm32-unknown-unknown/release/escrow.wasm"
fi

OPTIMIZED_WASM_FILE="${WASM_FILE%.wasm}.optimized.wasm"

if [ ! -f "$WASM_FILE" ]; then
  echo "Error: WASM file not found at '$WASM_FILE'" >&2
  exit 1
fi

RAW_SIZE=$(stat -c%s "$WASM_FILE")

# Check if optimized binary exists, otherwise use raw WASM size
if [ -f "$OPTIMIZED_WASM_FILE" ]; then
  EFFECTIVE_WASM="$OPTIMIZED_WASM_FILE"
  EFFECTIVE_SIZE=$(stat -c%s "$OPTIMIZED_WASM_FILE")
else
  EFFECTIVE_WASM="$WASM_FILE"
  EFFECTIVE_SIZE="$RAW_SIZE"
fi

RAW_KB=$(awk "BEGIN {printf \"%.2f\", $RAW_SIZE/1024}")
EFFECTIVE_KB=$(awk "BEGIN {printf \"%.2f\", $EFFECTIVE_SIZE/1024}")
MAX_KB=$(awk "BEGIN {printf \"%.2f\", $MAX_SIZE_BYTES/1024}")

echo "=========================================="
echo "Soroban WASM Size & Budget Report"
echo "=========================================="
echo "Unoptimized WASM: $RAW_SIZE bytes (${RAW_KB} KB)"
echo "Optimized WASM:   $EFFECTIVE_SIZE bytes (${EFFECTIVE_KB} KB)"
echo "Max Budget Limit: $MAX_SIZE_BYTES bytes (${MAX_KB} KB)"
echo "=========================================="

# Output metrics to GitHub Step Summary if running in GitHub Actions
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  cat << EOF >> "$GITHUB_STEP_SUMMARY"
### 📦 Soroban WASM Size & Budget Report

| Metric | Size (Bytes) | Size (KB) | Status |
| --- | --- | --- | --- |
| **Raw WASM** | \`${RAW_SIZE}\` | \`${RAW_KB} KB\` | - |
| **Optimized WASM** | \`${EFFECTIVE_SIZE}\` | \`${EFFECTIVE_KB} KB\` | - |
| **Size Limit Budget** | \`${MAX_SIZE_BYTES}\` | \`${MAX_KB} KB\` | **Max 64 KB** |

EOF

  if [ "$EFFECTIVE_SIZE" -le "$MAX_SIZE_BYTES" ]; then
    echo "✅ **WASM Size Budget Check Passed**: Optimized binary size (\`${EFFECTIVE_KB} KB\`) is within the 64 KB limit." >> "$GITHUB_STEP_SUMMARY"
  else
    echo "❌ **WASM Size Budget Exceeded**: Optimized binary size (\`${EFFECTIVE_KB} KB\`) exceeds the 64 KB limit!" >> "$GITHUB_STEP_SUMMARY"
  fi
fi

if [ "$EFFECTIVE_SIZE" -gt "$MAX_SIZE_BYTES" ]; then
  echo "FAIL: Contract binary size (${EFFECTIVE_SIZE} bytes / ${EFFECTIVE_KB} KB) exceeds maximum allowed budget (${MAX_SIZE_BYTES} bytes / ${MAX_KB} KB)!" >&2
  exit 1
else
  echo "SUCCESS: Contract binary size (${EFFECTIVE_SIZE} bytes / ${EFFECTIVE_KB} KB) is within budget limit (${MAX_SIZE_BYTES} bytes / ${MAX_KB} KB)."
fi
