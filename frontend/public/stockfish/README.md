# Stockfish.js (vendored)

Client-side chess engine used by `src/workers/stockfishWorker.ts` for the
spectator evaluation bar.

- Source: [`stockfish`](https://www.npmjs.com/package/stockfish) npm package v19.0.0
  (<https://github.com/nmrugg/stockfish.js>), files `bin/stockfish-19-lite-single.{js,wasm}`
- Build: lite, single-threaded WASM (no cross-origin isolation headers required)
- License: GPL-3.0, see `COPYING.txt`

Only the ~1.8 MB lite build is vendored; the npm package ships every engine
flavour (~200 MB) and would slow down every install.

SHA-256:

```
d3344124ab067fb0b90ee77873bb8e9fbf5fc01bc525fe714b0f942581e889e6  stockfish-19-lite-single.js
57ac2d72312aba346760e3f173f687a8c211208e97a87268436f7f0e10bb5387  stockfish-19-lite-single.wasm
```

To upgrade, copy the matching `-lite-single` files from a newer package release,
then update `ENGINE_URL` in `src/workers/stockfishWorker.ts` and this file.
