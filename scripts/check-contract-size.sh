#!/bin/bash
set -euo pipefail

# Check contract size regression
# This script checks the WASM size against a threshold

# Set threshold (64 KB = 65536 bytes)
MAX_SIZE=65536

# Check if WASM file exists
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

# Get file size
SIZE=$(stat -c%s "$WASM_FILE")
SIZE_KB=$((SIZE / 1024))

# Check if optimized binary exists, otherwise use raw WASM size
if [ -f "$OPTIMIZED_WASM_FILE" ]; then
    OPTIMIZED_SIZE=$(stat -c%s "$OPTIMIZED_WASM_FILE")
    OPTIMIZED_SIZE_KB=$((OPTIMIZED_SIZE / 1024))
    echo "Optimized contract size: $OPTIMIZED_SIZE bytes ($OPTIMIZED_SIZE_KB KB)"
fi

echo "Contract size: $SIZE bytes ($SIZE_KB KB)"
echo "Threshold: $MAX_SIZE bytes ($((MAX_SIZE / 1024)) KB)"

# Check if size exceeds threshold
if [ $SIZE -gt $MAX_SIZE ]; then
    echo "Error: Contract size ($SIZE bytes) exceeds threshold ($MAX_SIZE bytes)!"
    echo "Please optimize the contract to reduce its size."
    exit 1
fi

echo "Contract size check passed!"
