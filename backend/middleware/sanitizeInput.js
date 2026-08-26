/**
 * Input sanitization middleware.
 *
 * Rejects requests whose body/query/params contain an obvious injection
 * payload (script tags, inline event handlers, SQL/NoSQL injection
 * fragments) with a 400, and otherwise strips HTML tags from string values
 * in place so ordinary text (chat messages, usernames, etc.) reaches
 * downstream handlers clean.
 */
const DANGEROUS_PATTERNS = [
	/<script[\s\S]*?>[\s\S]*?<\/script>/i,
	/javascript:/i,
	/on\w+\s*=\s*["']/i,
	/\bunion\b[\s\S]*\bselect\b/i,
	/;\s*drop\s+table/i,
	/\$where\b/i,
	/\$ne\b/i,
];

function containsDangerousPayload(value) {
	if (typeof value !== "string") return false;
	return DANGEROUS_PATTERNS.some((pattern) => pattern.test(value));
}

function findDangerousPayload(value) {
	if (typeof value === "string") {
		return containsDangerousPayload(value) ? value : null;
	}
	if (Array.isArray(value)) {
		for (const item of value) {
			const found = findDangerousPayload(item);
			if (found) return found;
		}
		return null;
	}
	if (value && typeof value === "object") {
		for (const v of Object.values(value)) {
			const found = findDangerousPayload(v);
			if (found) return found;
		}
		return null;
	}
	return null;
}

function stripHtml(value) {
	return value.replace(/<[^>]*>/g, "").trim();
}

// Mutates properties in place rather than reassigning req.query/req.params,
// since Express 5 exposes those as getters that can't be replaced wholesale.
function sanitizeInPlace(obj) {
	if (!obj || typeof obj !== "object") return;
	for (const key of Object.keys(obj)) {
		const value = obj[key];
		if (typeof value === "string") {
			obj[key] = stripHtml(value);
		} else if (value && typeof value === "object") {
			sanitizeInPlace(value);
		}
	}
}

function sanitizeInput(req, res, next) {
	for (const source of [req.body, req.query, req.params]) {
		const dangerous = findDangerousPayload(source);
		if (dangerous) {
			return res.status(400).json({ success: false, error: "Malicious input detected" });
		}
	}

	sanitizeInPlace(req.body);
	sanitizeInPlace(req.query);
	sanitizeInPlace(req.params);

	return next();
}

module.exports = { sanitizeInput, containsDangerousPayload, stripHtml };
