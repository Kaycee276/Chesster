import { describe, it, expect } from "vitest";
import { truncateWallet } from "../../src/utils/truncateWallet";

describe("truncateWallet", () => {
  it("truncates normal 56-char Stellar address correctly", () => {
    const address = "GABC1234567890WXYZ1234567890ABCD1234567890WXYZ1234567890";
    expect(truncateWallet(address)).toBe("GABC...7890");
  });

  it("returns unchanged if address is shorter than 8 chars", () => {
    expect(truncateWallet("SHORT")).toBe("SHORT");
    expect(truncateWallet("TINY")).toBe("TINY");
  });

  it("returns unchanged if address is exactly 8 chars", () => {
    expect(truncateWallet("12345678")).toBe("12345678");
  });

  it("handles null safely", () => {
    expect(truncateWallet(null)).toBe("");
  });

  it("handles undefined safely", () => {
    expect(truncateWallet(undefined)).toBe("");
  });

  it("handles empty string safely", () => {
    expect(truncateWallet("")).toBe("");
  });

  it("respects custom char count", () => {
    const address = "GABC1234567890WXYZ1234567890ABCD1234567890WXYZ1234567890";
    expect(truncateWallet(address, 6)).toBe("GABC12...567890");
  });

  it("returns unchanged when custom char count exceeds string length", () => {
    const short = "HELLO";
    expect(truncateWallet(short, 10)).toBe("HELLO");
  });

  it("works with non-Stellar addresses", () => {
    const address = "0x742d35Cc6634C0532925a3b844Bc9e7595f42113"; // Ethereum
    expect(truncateWallet(address)).toBe("0x74...2113");
  });
});
