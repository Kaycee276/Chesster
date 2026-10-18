import { describe, expect, it } from "vitest";
import { formatTime, getTimeCategory, isValidTimeControl } from "./timeControl";

describe("time controls", () => {
  it("formats tenths below ten seconds and keeps standard precision otherwise", () => {
    expect(formatTime(8_450)).toBe("0:08.4");
    expect(formatTime(9_999)).toBe("0:09.9");
    expect(formatTime(10_000)).toBe("0:10");
    expect(formatTime(65_000)).toBe("1:05");
  });

  it("clamps invalid and negative times to zero", () => {
    expect(formatTime(-1)).toBe("0:00.0");
    expect(formatTime(Number.NaN)).toBe("0:00.0");
  });

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
