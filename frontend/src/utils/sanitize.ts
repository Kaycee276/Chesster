import DOMPurify from "dompurify";

const ALLOWED_TAGS = ["b", "i", "em", "strong", "a"];
const ALLOWED_ATTR = ["href", "target", "rel"];

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node instanceof Element && node.tagName.toLowerCase() === "a") {
    node.setAttribute("rel", "noopener noreferrer");
    node.setAttribute("target", "_blank");
  }
});

export function sanitizeHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    FORCE_BODY: true,
  });
}
