/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { sanitizeHtml } from "./sanitize";

describe("sanitizeHtml", () => {
  it("removes scripts, event handlers, and javascript URLs", () => {
    const result = sanitizeHtml(
      '<script>alert("xss")</script><img src=x onerror="alert(1)"><a href="javascript:alert(1)" onclick="alert(2)">safe</a>'
    );

    expect(result).not.toContain("script");
    expect(result).not.toContain("onerror");
    expect(result).not.toContain("onclick");
    expect(result).not.toContain("javascript:");
    expect(result).toContain("safe");
  });

  it("preserves safe formatting, emojis, and https links with safe rel attributes", () => {
    const result = sanitizeHtml(
      '<strong>Good luck!</strong> 😀 <a href="https://example.com">Link</a>'
    );

    expect(result).toContain("<strong>Good luck!</strong>");
    expect(result).toContain("😀");
    expect(result).toContain('href="https://example.com"');
    expect(result).toContain('rel="noopener noreferrer"');
    expect(result).toContain('target="_blank"');
  });
});
