/**
 * Request validation middleware for the tournament REST API.
 *
 * The project intentionally avoids adding a runtime schema dependency (no Zod
 * or Joi in package.json), so this module provides a tiny, dependency-free
 * validator with the same ergonomics: declare a schema, get a middleware that
 * rejects malformed input with a 400 before the controller runs.
 *
 * Supported rule shape:
 *   { type: 'string'|'number'|'boolean', required, enum, min, max, pattern, default }
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Stellar ed25519 public keys are 56-char base32 strings starting with "G".
const STELLAR_ADDRESS_PATTERN = /^G[A-Z2-7]{55}$/;

const TOURNAMENT_STATUSES = ["draft", "open", "in_progress", "completed", "cancelled"];

/** Validate a single value against a rule, returning an error string or null. */
function validateValue(value, rule, field) {
	if (value === undefined || value === null || value === "") {
		if (rule.required) return `${field} is required`;
		return null;
	}

	if (rule.type === "number") {
		const num = Number(value);
		if (Number.isNaN(num)) return `${field} must be a number`;
		if (rule.min !== undefined && num < rule.min) return `${field} must be >= ${rule.min}`;
		if (rule.max !== undefined && num > rule.max) return `${field} must be <= ${rule.max}`;
		return null;
	}

	if (rule.type === "boolean") {
		if (typeof value !== "boolean" && value !== "true" && value !== "false") {
			return `${field} must be a boolean`;
		}
		return null;
	}

	// Default to string validation.
	if (typeof value !== "string") return `${field} must be a string`;
	if (rule.enum && !rule.enum.includes(value)) {
		return `${field} must be one of: ${rule.enum.join(", ")}`;
	}
	if (rule.pattern && !rule.pattern.test(value)) return `${field} has an invalid format`;
	if (rule.min !== undefined && value.length < rule.min) return `${field} must be at least ${rule.min} characters`;
	if (rule.max !== undefined && value.length > rule.max) return `${field} must be at most ${rule.max} characters`;
	return null;
}

/**
 * Build an Express middleware validating `req[source]` against `schema`.
 * @param {object} schema - map of field name -> rule
 * @param {'body'|'query'|'params'} source
 */
function validate(schema, source = "body") {
	return function validationMiddleware(req, res, next) {
		const payload = req[source] || {};
		const errors = [];
		const sanitized = {};

		for (const [field, rule] of Object.entries(schema)) {
			const raw = payload[field];
			const error = validateValue(raw, rule, field);
			if (error) {
				errors.push(error);
				continue;
			}

			if (raw === undefined || raw === null || raw === "") {
				if (rule.default !== undefined) sanitized[field] = rule.default;
				continue;
			}

			if (rule.type === "number") {
				sanitized[field] = Number(raw);
			} else if (rule.type === "boolean") {
				sanitized[field] = raw === true || raw === "true";
			} else {
				sanitized[field] = raw;
			}
		}

		if (errors.length > 0) {
			return res.status(400).json({ success: false, error: errors.join("; "), errors });
		}

		// Expose coerced values on a dedicated property. Express 5 exposes
		// req.query/req.params as getters that can't be replaced wholesale, so
		// controllers read the validated snapshot instead of the raw source.
		req.validated = req.validated || {};
		req.validated[source] = { ...payload, ...sanitized };

		// Best-effort in-place mutation for plain objects (e.g. req.body).
		for (const [field, value] of Object.entries(sanitized)) {
			try {
				payload[field] = value;
			} catch {
				// Read-only source (Express 5 query/params) — req.validated covers it.
			}
		}
		return next();
	};
}

const listTournamentsSchema = {
	status: { type: "string", enum: TOURNAMENT_STATUSES },
	limit: { type: "number", min: 1, max: 100, default: 50 },
};

const tournamentIdSchema = {
	id: { type: "string", required: true, pattern: UUID_PATTERN },
};

const registerPlayerSchema = {
	walletAddress: { type: "string", required: true, pattern: STELLAR_ADDRESS_PATTERN },
	signature: { type: "string", required: true, min: 1 },
};

module.exports = {
	validate,
	validateValue,
	listTournamentsSchema,
	tournamentIdSchema,
	registerPlayerSchema,
	TOURNAMENT_STATUSES,
	UUID_PATTERN,
	STELLAR_ADDRESS_PATTERN,
};
