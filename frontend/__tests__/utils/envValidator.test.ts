import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { validateFrontendEnv, REQUIRED_FRONTEND_VARS } from "../../src/utils/envValidator";

describe("Frontend Environment Validator (envValidator)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("defines required frontend variables list", () => {
    const keys = REQUIRED_FRONTEND_VARS.map((v) => v.key);
    expect(keys).toContain("VITE_BACKEND_URL");
    expect(keys).toContain("VITE_CONTRACT_ID");
  });

  it("returns a boolean indicating validation status", () => {
    const result = validateFrontendEnv();
    expect(typeof result).toBe("boolean");
  });

  it("logs console warning if environment variables are missing", () => {
    validateFrontendEnv();
    // Since VITE_BACKEND_URL or VITE_CONTRACT_ID may be unset in test env, console.warn is called if missing
    if (!import.meta.env.VITE_BACKEND_URL || !import.meta.env.VITE_CONTRACT_ID) {
      expect(warnSpy).toHaveBeenCalled();
    }
  });
});
