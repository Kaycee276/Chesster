/**
 * Input sanitization middleware.
 *
 * Walks `req.body`, `req.query`, and `req.params`, and:
 *   - rejects the request with a 400 when any string value contains a payload
 *     that looks like an XSS, SQL-injection, or NoSQL-injection attempt, and
 *   - strips benign HTML tags from every other string value in place.
 *
 * This is a defense-in-depth layer that runs before route handlers. It never
 * trusts client-supplied input and pairs with the per-route rate limiter.
 */

// Patterns that indicate a deliberately malicious payload. A match rejects the
// whole request rather than silently rewriting it.
const DANGEROUS_PATTERNS = [
	/<\s*script\b/i, // inline script tag
	/<\/\s*script\s*>/i,
	/javascript:/i, // dangerous URI schemes
	/vbscript:/i,
	/data:\s*text\/html/i,
	/\son\w+\s*=/i, // event handler attributes, e.g. onerror=
	/\bunion\b\s+\bselect\b/i, // SQL injection
	/\bdrop\b\s+\btable\b/i,
	/\binsert\b\s+\binto\b/i,
	/\bdelete\b\s+\bfrom\b/i,
	/\bselect\b\s+.*\bfrom\b/i,
	/\$where\b/i, // NoSQL operator injection
	/\$ne\b/i,
	/\$gt\b/i,
	/\$lt\b/i,
	/\$regex\b/i,
];

/**
 * Return true when a string looks like a malicious payload. Non-string input is
 * never dangerous (returns false).
 */
function containsDangerousPayload(value) {
	if (typeof value !== "string") return false;
	return DANGEROUS_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * Remove HTML tags from a value and trim surrounding whitespace.
 */
function stripHtml(value) {
	if (typeof value !== "string") return value;
	return value.replace(/<[^>]*>/g, "").trim();
}

/**
 * Recursively sanitize a container (object or array) in place.
 * Returns true as soon as a dangerous payload is found.
 */
function sanitizeContainer(container) {
	if (!container || typeof container !== "object") return false;

	for (const key of Object.keys(container)) {
		const value = container[key];

		if (typeof value === "string") {
			if (containsDangerousPayload(value)) return true;
			container[key] = stripHtml(value);
		} else if (value && typeof value === "object") {
			if (sanitizeContainer(value)) return true;
		}
	}

	return false;
}

/**
 * Express middleware entry point.
 */
function sanitizeInput(req, res, next) {
	try {
		for (const part of [req.body, req.query, req.params]) {
			if (sanitizeContainer(part)) {
				return res.status(400).json({
					success: false,
					error: "Request contains disallowed or potentially malicious input.",
				});
			}
		}
		return next();
	} catch (err) {
		return next(err);
	}
}

module.exports = {
	sanitizeInput,
	containsDangerousPayload,
	stripHtml,
};
