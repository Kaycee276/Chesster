default: build

test:
	cargo test

build:
	cargo build --target wasm32-unknown-unknown --release

optimize: build
	@if command -v soroban >/dev/null 2>&1; then \
		soroban contract optimize --wasm target/wasm32-unknown-unknown/release/escrow.wasm; \
	elif command -v stellar >/dev/null 2>&1; then \
		stellar contract optimize --wasm target/wasm32-unknown-unknown/release/escrow.wasm; \
	else \
		echo "Neither soroban nor stellar CLI found for optimization"; exit 1; \
	fi

clean:
	cargo clean
