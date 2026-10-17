/**
 * IP utility functions for session binding and security.
 * Extracts IP subnets for security fingerprinting and rate limiting.
 */

/**
 * Parse and normalize an IPv6 address to its canonical form.
 * Handles compressed notation (::), expands it, normalizes case.
 *
 * Examples:
 *   "2001:db8::1" -> "2001:0db8:0000:0000:0000:0000:0000:0001"
 *   "2001:DB8::1" -> "2001:0db8:0000:0000:0000:0000:0000:0001"
 *   "::1" -> "0000:0000:0000:0000:0000:0000:0000:0001"
 *   "::ffff:192.0.2.1" -> "0000:0000:0000:0000:0000:ffff:c000:0201"
 *
 * @param {string} ip - IPv6 address (may be compressed)
 * @returns {string|null} Fully expanded canonical IPv6 or null on error
 */
function normalizeIPv6(ip) {
	if (!ip || typeof ip !== "string") return null;

	ip = ip.trim().toLowerCase();

	// Handle IPv4-mapped IPv6 addresses like ::ffff:192.0.2.1
	const ipv4Match = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
	if (ipv4Match) {
		// Return marker so caller can detect and unwrap
		return `ipv4-mapped:${ipv4Match[1]}`;
	}

	// Basic validation: should only contain hex digits, colons
	if (!/^[0-9a-f:]+$/i.test(ip)) {
		return null;
	}

	// Split on ::
	const parts = ip.split("::");
	if (parts.length > 2) {
		return null; // Invalid: multiple ::
	}

	let left = [];
	let right = [];

	if (parts[0]) {
		left = parts[0].split(":").filter(Boolean);
	}
	if (parts.length > 1 && parts[1]) {
		right = parts[1].split(":").filter(Boolean);
	}

	// Calculate zeros needed in the middle
	const totalGroups = 8;
	const zerosNeeded = totalGroups - left.length - right.length;
	if (zerosNeeded < 0) {
		return null; // Too many groups
	}

	// Build expanded form
	const expanded = [
		...left,
		...Array(zerosNeeded).fill("0000"),
		...right,
	];

	if (expanded.length !== 8) {
		return null;
	}

	// Pad each group to 4 hex digits and return
	return expanded.map((g) => g.padStart(4, "0").toLowerCase()).join(":");
}

/**
 * Extract /48 subnet from a normalized IPv6 address.
 * Takes the first 3 groups (48 bits) and zeroes the rest.
 *
 * Examples:
 *   "2001:0db8:abcd:0012:0000:0000:0000:0001" -> "2001:0db8:abcd::/48"
 *
 * @param {string} normalized - Fully expanded IPv6 (from normalizeIPv6)
 * @returns {string} IPv6 /48 subnet in canonical form
 */
function extractIPv6Subnet(normalized) {
	const groups = normalized.split(":");
	if (groups.length !== 8) return normalized;
	// Keep first 3 groups, zero the rest
	return `${groups[0]}:${groups[1]}:${groups[2]}::/48`;
}

/**
 * Extract /24 or /48 subnet from an IP address.
 * Handles IPv4 (/24), IPv6 (/48), and IPv4-mapped IPv6 (unwraps to IPv4 /24).
 *
 * Returns a normalized, canonical subnet string suitable for rate limiting keys.
 * Handles compressed IPv6, mixed case, and leading zeros correctly.
 *
 * Examples:
 *   "192.0.2.1" -> "192.0.2.0/24"
 *   "192.0.2.254" -> "192.0.2.0/24"
 *   "2001:db8:abcd:12::1" -> "2001:0db8:abcd::/48"
 *   "::ffff:192.0.2.1" -> "192.0.2.0/24" (unwrapped to IPv4)
 *   "::1" -> "0000:0000:0000::/48" (IPv6 loopback)
 *
 * On error (malformed, null, undefined), returns "unknown-subnet" as a fallback
 * so the attacker cannot use malformed input to dodge limits entirely.
 *
 * @param {string} ip - Client IP address (IPv4, IPv6, or IPv4-mapped IPv6)
 * @returns {string} Canonical subnet key (e.g. "192.0.2.0/24" or "2001:0db8:abcd::/48")
 */
function getSubnetFromIp(ip) {
	if (!ip || typeof ip !== "string") {
		return "unknown-subnet";
	}

	ip = ip.trim();
	if (!ip) {
		return "unknown-subnet";
	}

	// IPv4: simple regex match and mask to /24
	if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
		const parts = ip.split(".");
		if (parts.length === 4) {
			const octets = parts.map((p) => parseInt(p, 10));
			// Validate each octet is 0-255
			if (octets.every((o) => o >= 0 && o <= 255)) {
				return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
			}
		}
		return "unknown-subnet";
	}

	// IPv6 or IPv4-mapped IPv6
	const normalized = normalizeIPv6(ip);
	if (!normalized) {
		return "unknown-subnet";
	}

	// Check if it's an IPv4-mapped address that we unwrapped
	if (normalized.startsWith("ipv4-mapped:")) {
		const ipv4Addr = normalized.split(":")[1];
		const parts = ipv4Addr.split(".");
		const octets = parts.map((p) => parseInt(p, 10));
		if (octets.every((o) => o >= 0 && o <= 255)) {
			return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
		}
		return "unknown-subnet";
	}

	// IPv6: extract /48 subnet
	return extractIPv6Subnet(normalized);
}

/**
 * Normalize and extract the IP subnet from a request.
 * Handles IPv4 addresses by extracting the first 3 octets (class C /24 subnet).
 * For IPv6 or unrecognized formats, returns the full IP.
 *
 * Examples:
 *   "192.168.1.100" -> "192.168.1"
 *   "10.0.0.5" -> "10.0.0"
 *   "2001:db8::1" -> "2001:db8::1" (IPv6 returned as-is for now)
 *   "127.0.0.1" -> "127.0.0.1" (localhost)
 *
 * @param {string} ip - Client IP address
 * @returns {string} IP subnet or full IP
 */
function extractIpSubnet(ip) {
	if (ip === null || ip === undefined) return null;
	if (typeof ip !== "string") return null;

	// Trim whitespace
	ip = ip.trim();

	// IPv4: extract first 3 octets for /24 subnet
	if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
		const parts = ip.split(".");
		if (parts.length === 4) {
			return `${parts[0]}.${parts[1]}.${parts[2]}`;
		}
	}

	// IPv6 or other: return as-is for now
	return ip;
}

/**
 * Get the client IP from an Express request, handling proxies and headers.
 * Checks X-Forwarded-For, CF-Connecting-IP, and falls back to remoteAddress.
 *
 * @param {object} req - Express request object
 * @returns {string} Client IP address or null
 */
function getClientIp(req) {
	if (!req) return null;

	// X-Forwarded-For (may contain multiple IPs: client, proxy1, proxy2, ...)
	const xForwardedFor = req.headers["x-forwarded-for"];
	if (xForwardedFor) {
		const ips = xForwardedFor.split(",");
		const clientIp = ips[0].trim();
		if (clientIp) return clientIp;
	}

	// Cloudflare
	const cfConnectingIp = req.headers["cf-connecting-ip"];
	if (cfConnectingIp) return cfConnectingIp.trim();

	// Direct connection
	if (req.socket?.remoteAddress) {
		return req.socket.remoteAddress;
	}

	if (req.connection?.remoteAddress) {
		return req.connection.remoteAddress;
	}

	return null;
}

/**
 * Extract and normalize IP subnet from request.
 * Combines getClientIp and extractIpSubnet for convenience.
 *
 * @param {object} req - Express request object
 * @returns {string} IP subnet or null
 */
function getIpSubnetFromRequest(req) {
	const ip = getClientIp(req);
	return ip ? extractIpSubnet(ip) : null;
}

module.exports = {
	extractIpSubnet,
	getClientIp,
	getIpSubnetFromRequest,
	getSubnetFromIp,
	normalizeIPv6,
	extractIPv6Subnet,
};
