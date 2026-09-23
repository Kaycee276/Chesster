/**
 * Chat message sanitization for the in-game chat panel.
 *
 * Chat text is rendered as a React text node, which already HTML-escapes its
 * content, so stored markup is never parsed as HTML. This module adds an
 * explicit defense-in-depth layer: it strips any HTML tags and neutralizes
 * common script vectors before the message reaches the DOM, so a crafted
 * payload such as `<img src=x onerror=...>` or `<script>...</script>` can never
 * survive to be rendered, copied, or forwarded as live markup.
 *
 * A dedicated sanitizer library (for example DOMPurify) is the usual choice
 * when rendering rich HTML via dangerouslySetInnerHTML. This panel renders
 * plain text only, so a tag-stripping sanitizer is sufficient and avoids
 * shipping an HTML parser to every client. See the PR description for the
 * rationale.
 */

const TAG_PATTERN = /<[^>]*>/g;
const DANGEROUS_SCHEME_PATTERN = /(javascript|data|vbscript)\s*:/gi;
const ANGLE_BRACKET_PATTERN = /[<>]/g;

/**
 * Return a plain-text, XSS-safe version of a chat message.
 *
 * Non-string input yields an empty string so callers can render the result
 * unconditionally.
 */
export function sanitizeChatMessage(raw: unknown): string {
	if (typeof raw !== "string") return "";

	return raw
		.replace(TAG_PATTERN, "")
		.replace(DANGEROUS_SCHEME_PATTERN, "")
		.replace(ANGLE_BRACKET_PATTERN, "")
		.trim();
}
