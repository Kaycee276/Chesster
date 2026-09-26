import { describe, expect, it } from "vitest";
import { getTimeCategory, isValidTimeControl } from "./timeControl";

describe("time controls", () => {
  it("classifies custom controls using the FIDE formula", () => {
    expect(getTimeCategory(2, 0)).toBe("Bullet");
    expect(getTimeCategory(3, 0)).toBe("Blitz");
    expect(getTimeCategory(10, 0)).toBe("Rapid");
    expect(getTimeCategory(60, 0)).toBe("Classical");
  });

  it("validates the supported slider ranges", () => {
    expect(isValidTimeControl(1, 0)).toBe(true);
    expect(isValidTimeControl(60, 30)).toBe(true);
    expect(isValidTimeControl(0, 0)).toBe(false);
    expect(isValidTimeControl(10, 31)).toBe(false);
  });
});
