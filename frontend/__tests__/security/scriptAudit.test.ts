import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Frontend Script & Asset Security Audit (Issue #325)", () => {
  const indexPath = path.resolve(__dirname, "../../index.html");
  const indexHtml = fs.readFileSync(indexPath, "utf-8");

  it("ensures no unbundled external Google Fonts or CDNs exist in index.html", () => {
    expect(indexHtml).not.toContain("fonts.googleapis.com");
    expect(indexHtml).not.toContain("cdnjs.cloudflare.com");
    expect(indexHtml).not.toContain("unpkg.com");
    expect(indexHtml).not.toContain("cdn.jsdelivr.net");
  });

  it("ensures any external scripts or links have subresource integrity (SRI) attributes", () => {
    // Regex matching any <script src="http..."> or <link href="http...">
    const externalScriptOrLinkRegex = /<(?:script|link)[^>]+(?:src|href)=["']https?:\/\/[^"']+["'][^>]*>/gi;
    const matches = indexHtml.match(externalScriptOrLinkRegex) || [];

    for (const tag of matches) {
      expect(tag).toMatch(/integrity=["']sha(?:256|384|512)-/);
      expect(tag).toMatch(/crossorigin=["']anonymous["']/);
    }
  });

  it("ensures index.css does not load remote stylesheets via @import", () => {
    const cssPath = path.resolve(__dirname, "../../src/index.css");
    const cssContent = fs.readFileSync(cssPath, "utf-8");

    expect(cssContent).not.toMatch(/@import\s+url\(["']?https?:\/\//i);
  });
});
