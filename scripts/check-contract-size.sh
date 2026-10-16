#!/bin/bash
# Check contract size regression
# This script builds the escrow contract and checks its WASM size against a threshold

# Set threshold (64 KB = 65536 bytes)
MAX_SIZE=65536

# Change to contracts/soroban directory
cd contracts/soroban

# Build the contract
echo "Building escrow contract..."
cargo build --target wasm32-unknown-unknown --release

# Check if WASM file exists
WASM_FILE="target/wasm32-unknown-unknown/release/escrow.wasm"
if [ ! -f "$WASM_FILE" ]; then
    echo "Error: WASM file not found at $WASM_FILE"
        exit 1
        fi

        # Get file size
        SIZE=$(stat -c%s "$WASM_FILE")
        SIZE_KB=$((SIZE / 1024))

        echo "Contract size: $SIZE bytes ($SIZE_KB KB)"
        echo "Threshold: $MAX_SIZE bytes ($((MAX_SIZE / 1024)) KB)"

        # Check if size exceeds threshold
        if [ $SIZE -gt $MAX_SIZE ]; then
            echo "Error: Contract size ($SIZE bytes) exceeds threshold ($MAX_SIZE bytes)!"
                echo "Please optimize the contract to reduce its size."
                    exit 1
                    fi

                    echo "Contract size check passed!"
                    
