// Worker script that fails while loading, to exercise the pool's
// crash-loop guard.
throw new Error("worker failed to load");
