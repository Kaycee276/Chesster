#!/usr/bin/env bash
set -euo pipefail

# Soroban WASM Size Regression Check
# Verifies that compiled WASM binaries stay within a defined size budget.
# Usage: ./check-wasm-size.sh [WASM_FILE_PATH]
#        MAX_WASM_BYTES=65536 ./check-wasm-size.sh [WASM_FILE_PATH]

# Resolve script directory for portable path resolution
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# WASM Budget Limit in Bytes (128 KB = 131072 bytes)
# Can be overridden via environment variable, must be positive integer
MAX_WASM_BYTES="${MAX_WASM_BYTES:-131072}"

# Validate MAX_WASM_BYTES is a positive integer
if ! [[ "$MAX_WASM_BYTES" =~ ^[0-9]+$ ]] || [ "$MAX_WASM_BYTES" -le 0 ]; then
  echo "Error: MAX_WASM_BYTES must be a positive integer, got: $MAX_WASM_BYTES" >&2
  exit 1
fi

# Determine WASM file path
# Priority: 1) Command line argument, 2) Relative from soroban directory, 3) Relative from repo root
if [ -n "${1:-}" ]; then
  # Argument provided: use as-is (allow relative or absolute)
  WASM_FILE="$1"
  # Make relative paths absolute from current directory
  if [[ "$WASM_FILE" != /* ]]; then
    WASM_FILE="$(cd "$(pwd)" && pwd)/$WASM_FILE"
  fi
elif [ -f "$SCRIPT_DIR/../target/wasm32-unknown-unknown/release/escrow.wasm" ]; then
  # Standard location from soroban directory
  WASM_FILE="$SCRIPT_DIR/../target/wasm32-unknown-unknown/release/escrow.wasm"
elif [ -f "$REPO_ROOT/contracts/soroban/target/wasm32-unknown-unknown/release/escrow.wasm" ]; then
  # Alternative: from repo root
  WASM_FILE="$REPO_ROOT/contracts/soroban/target/wasm32-unknown-unknown/release/escrow.wasm"
else
  # Fall back to expected path (will fail if file doesn't exist)
  WASM_FILE="$SCRIPT_DIR/../target/wasm32-unknown-unknown/release/escrow.wasm"
fi

# Check if WASM file exists
if [ ! -f "$WASM_FILE" ]; then
  echo "Error: WASM file not found at '$WASM_FILE'" >&2
  echo "       Please build the contract first with: make optimize" >&2
  exit 1
fi

# Get size using portable method (wc -c works on Linux, macOS, and BSD)
WASM_SIZE=$(wc -c < "$WASM_FILE")

# Derive optimized WASM path (if it exists)
OPTIMIZED_WASM_FILE="${WASM_FILE%.wasm}.optimized.wasm"
if [ -f "$OPTIMIZED_WASM_FILE" ]; then
  OPTIMIZED_SIZE=$(wc -c < "$OPTIMIZED_WASM_FILE")
  EFFECTIVE_SIZE="$OPTIMIZED_SIZE"
  EFFECTIVE_FILE="$OPTIMIZED_WASM_FILE"
else
  EFFECTIVE_SIZE="$WASM_SIZE"
  EFFECTIVE_FILE="$WASM_FILE"
fi

# Calculate KB values for display
WASM_KB=$(awk "BEGIN {printf \"%.2f\", $WASM_SIZE/1024}")
OPTIMIZED_KB=$(awk "BEGIN {printf \"%.2f\", $OPTIMIZED_SIZE/1024}" 2>/dev/null || echo "$WASM_KB")
EFFECTIVE_KB=$(awk "BEGIN {printf \"%.2f\", $EFFECTIVE_SIZE/1024}")
MAX_KB=$(awk "BEGIN {printf \"%.2f\", $MAX_WASM_BYTES/1024}")

# Calculate headroom or overage
if [ "$EFFECTIVE_SIZE" -le "$MAX_WASM_BYTES" ]; then
  HEADROOM=$((MAX_WASM_BYTES - EFFECTIVE_SIZE))
  HEADROOM_KB=$(awk "BEGIN {printf \"%.2f\", $HEADROOM/1024}")
  PERCENT_USED=$(awk "BEGIN {printf \"%.1f\", ($EFFECTIVE_SIZE/$MAX_WASM_BYTES)*100}")
else
  OVERAGE=$((EFFECTIVE_SIZE - MAX_WASM_BYTES))
  OVERAGE_KB=$(awk "BEGIN {printf \"%.2f\", $OVERAGE/1024}")
  PERCENT_USED=$(awk "BEGIN {printf \"%.1f\", ($EFFECTIVE_SIZE/$MAX_WASM_BYTES)*100}")
fi

# Format output
echo "=========================================="
echo "Soroban WASM Size & Budget Report"
echo "=========================================="
echo "Raw WASM:         $WASM_SIZE bytes (${WASM_KB} KB)"
if [ -f "$OPTIMIZED_WASM_FILE" ]; then
  echo "Optimized WASM:   $OPTIMIZED_SIZE bytes (${OPTIMIZED_KB} KB)"
fi
echo "Effective Size:   $EFFECTIVE_SIZE bytes (${EFFECTIVE_KB} KB)"
echo "Max Budget:       $MAX_WASM_BYTES bytes (${MAX_KB} KB)"
if [ "$EFFECTIVE_SIZE" -le "$MAX_WASM_BYTES" ]; then
  echo "Headroom:         $HEADROOM bytes (${HEADROOM_KB} KB) - ${PERCENT_USED}% used"
else
  echo "OVERAGE:          $OVERAGE bytes (${OVERAGE_KB} KB) - ${PERCENT_USED}% of budget"
fi
echo "=========================================="

# Output summary to GitHub Step Summary if in Actions environment
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### 📦 Soroban WASM Size & Budget Check"
    echo ""
    echo "| Metric | Size (Bytes) | Size (KB) |"
    echo "| --- | --- | --- |"
    echo "| **Raw WASM** | \`${WASM_SIZE}\` | \`${WASM_KB} KB\` |"
    if [ -f "$OPTIMIZED_WASM_FILE" ]; then
      echo "| **Optimized WASM** | \`${OPTIMIZED_SIZE}\` | \`${OPTIMIZED_KB} KB\` |"
    fi
    echo "| **Effective Size** | \`${EFFECTIVE_SIZE}\` | \`${EFFECTIVE_KB} KB\` |"
    echo "| **Budget Limit** | \`${MAX_WASM_BYTES}\` | \`${MAX_KB} KB\` |"
    echo ""
    if [ "$EFFECTIVE_SIZE" -le "$MAX_WASM_BYTES" ]; then
      echo "✅ **PASS**: WASM size (\`${EFFECTIVE_KB} KB\`, ${PERCENT_USED}% of budget) is within limit (\`${MAX_KB} KB\`)"
    else
      echo "❌ **FAIL**: WASM size (\`${EFFECTIVE_KB} KB\`) exceeds limit (\`${MAX_KB} KB\`) by \`${OVERAGE_KB} KB\`"
    fi
  } >> "$GITHUB_STEP_SUMMARY"
fi

# Exit with appropriate code
if [ "$EFFECTIVE_SIZE" -gt "$MAX_WASM_BYTES" ]; then
  echo "❌ FAIL: Contract binary size (${EFFECTIVE_SIZE} bytes / ${EFFECTIVE_KB} KB) exceeds maximum allowed budget (${MAX_WASM_BYTES} bytes / ${MAX_KB} KB)!" >&2
  exit 1
else
  echo "✅ SUCCESS: Contract binary size (${EFFECTIVE_SIZE} bytes / ${EFFECTIVE_KB} KB) is within budget limit (${MAX_WASM_BYTES} bytes / ${MAX_KB} KB)."
  exit 0
fi
