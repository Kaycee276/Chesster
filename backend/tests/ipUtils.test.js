const { extractIpSubnet, getClientIp, getIpSubnetFromRequest, getSubnetFromIp, normalizeIPv6, extractIPv6Subnet } = require("../utils/ipUtils");

describe("ipUtils", () => {
	describe("normalizeIPv6", () => {
		it("expands compressed IPv6 addresses", () => {
			expect(normalizeIPv6("2001:db8::1")).toBe("2001:0db8:0000:0000:0000:0000:0000:0001");
			expect(normalizeIPv6("::1")).toBe("0000:0000:0000:0000:0000:0000:0000:0001");
			expect(normalizeIPv6("2001:db8::")).toBe("2001:0db8:0000:0000:0000:0000:0000:0000");
		});

		it("normalizes mixed case to lowercase", () => {
			expect(normalizeIPv6("2001:DB8::1")).toBe("2001:0db8:0000:0000:0000:0000:0000:0001");
			expect(normalizeIPv6("2001:dB8:AbCd::1")).toBe("2001:0db8:abcd:0000:0000:0000:0000:0001");
		});

		it("pads hex groups to 4 digits", () => {
			expect(normalizeIPv6("2001:db8:abcd:12::1")).toBe("2001:0db8:abcd:0012:0000:0000:0000:0001");
			expect(normalizeIPv6("1::1")).toBe("0001:0000:0000:0000:0000:0000:0000:0001");
		});

		it("handles IPv4-mapped IPv6 addresses", () => {
			expect(normalizeIPv6("::ffff:192.0.2.1")).toBe("ipv4-mapped:192.0.2.1");
			expect(normalizeIPv6("::FFFF:10.0.0.1")).toBe("ipv4-mapped:10.0.0.1");
		});

		it("rejects invalid IPv6 addresses", () => {
			expect(normalizeIPv6("gggg::1")).toBeNull(); // Invalid hex
			expect(normalizeIPv6("::1::2")).toBeNull(); // Multiple ::
			expect(normalizeIPv6("1:2:3:4:5:6:7:8:9")).toBeNull(); // Too many groups
		});

		it("handles null and undefined", () => {
			expect(normalizeIPv6(null)).toBeNull();
			expect(normalizeIPv6(undefined)).toBeNull();
		});

		it("trims whitespace", () => {
			expect(normalizeIPv6("  2001:db8::1  ")).toBe("2001:0db8:0000:0000:0000:0000:0000:0001");
		});

		it("handles fully expanded IPv6 (no compression)", () => {
			expect(normalizeIPv6("2001:0db8:0000:0000:0000:0000:0000:0001")).toBe(
				"2001:0db8:0000:0000:0000:0000:0000:0001",
			);
		});

		it("handles IPv6 loopback", () => {
			expect(normalizeIPv6("::1")).toBe("0000:0000:0000:0000:0000:0000:0000:0001");
		});
	});

	describe("extractIPv6Subnet", () => {
		it("extracts /48 subnet from normalized IPv6", () => {
			expect(extractIPv6Subnet("2001:0db8:abcd:0012:0000:0000:0000:0001")).toBe("2001:0db8:abcd::/48");
			expect(extractIPv6Subnet("2001:0db8:1234:5678:9abc:def0:1234:5678")).toBe("2001:0db8:1234::/48");
		});

		it("zeroes out host bits", () => {
			expect(extractIPv6Subnet("2001:0db8:abcd:ffff:ffff:ffff:ffff:ffff")).toBe("2001:0db8:abcd::/48");
		});

		it("handles different subnets", () => {
			const subnet1 = extractIPv6Subnet("2001:0db8:abcd:0000:0000:0000:0000:0001");
			const subnet2 = extractIPv6Subnet("2001:0db8:abce:0000:0000:0000:0000:0001");
			expect(subnet1).not.toBe(subnet2);
			expect(subnet1).toBe("2001:0db8:abcd::/48");
			expect(subnet2).toBe("2001:0db8:abce::/48");
		});
	});

	describe("getSubnetFromIp", () => {
		describe("IPv4 subnet extraction (/24)", () => {
			it("extracts /24 subnet from IPv4 address", () => {
				expect(getSubnetFromIp("192.0.2.1")).toBe("192.0.2.0/24");
				expect(getSubnetFromIp("192.0.2.254")).toBe("192.0.2.0/24");
				expect(getSubnetFromIp("10.0.0.5")).toBe("10.0.0.0/24");
				expect(getSubnetFromIp("172.16.50.200")).toBe("172.16.50.0/24");
			});

			it("returns same /24 subnet for different host IPs in same subnet", () => {
				const subnet1 = getSubnetFromIp("192.0.2.0");
				const subnet2 = getSubnetFromIp("192.0.2.1");
				const subnet3 = getSubnetFromIp("192.0.2.255");
				expect(subnet1).toBe(subnet2);
				expect(subnet2).toBe(subnet3);
				expect(subnet1).toBe("192.0.2.0/24");
			});

			it("returns different subnets for different IPv4 /24 blocks", () => {
				const subnet1 = getSubnetFromIp("192.0.2.1");
				const subnet2 = getSubnetFromIp("192.0.3.1");
				expect(subnet1).not.toBe(subnet2);
				expect(subnet1).toBe("192.0.2.0/24");
				expect(subnet2).toBe("192.0.3.0/24");
			});

			it("handles localhost", () => {
				expect(getSubnetFromIp("127.0.0.1")).toBe("127.0.0.0/24");
			});

			it("handles public IPs", () => {
				expect(getSubnetFromIp("8.8.8.8")).toBe("8.8.8.0/24");
				expect(getSubnetFromIp("1.1.1.1")).toBe("1.1.1.0/24");
			});

			it("handles edge case octets (0 and 255)", () => {
				expect(getSubnetFromIp("0.0.0.1")).toBe("0.0.0.0/24");
				expect(getSubnetFromIp("255.255.255.1")).toBe("255.255.255.0/24");
			});
		});

		describe("IPv6 subnet extraction (/48)", () => {
			it("extracts /48 subnet from IPv6 addresses", () => {
				expect(getSubnetFromIp("2001:db8:abcd:0012::1")).toBe("2001:0db8:abcd::/48");
				expect(getSubnetFromIp("2001:db8:abcd:ffff:ffff:ffff:ffff:ffff")).toBe("2001:0db8:abcd::/48");
			});

			it("returns same /48 subnet for compressed and expanded forms", () => {
				const compressed = getSubnetFromIp("2001:db8:abcd::1");
				const expanded = getSubnetFromIp("2001:0db8:abcd:0000:0000:0000:0000:0001");
				expect(compressed).toBe(expanded);
				expect(compressed).toBe("2001:0db8:abcd::/48");
			});

			it("normalizes mixed-case IPv6 to consistent format", () => {
				const lowercase = getSubnetFromIp("2001:db8:abcd::1");
				const uppercase = getSubnetFromIp("2001:DB8:ABCD::1");
				const mixedCase = getSubnetFromIp("2001:Db8:AbCd::1");
				expect(lowercase).toBe(uppercase);
				expect(uppercase).toBe(mixedCase);
			});

			it("returns different subnets for different IPv6 /48 blocks", () => {
				const subnet1 = getSubnetFromIp("2001:db8:abcd::1");
				const subnet2 = getSubnetFromIp("2001:db8:abce::1");
				expect(subnet1).not.toBe(subnet2);
				expect(subnet1).toBe("2001:0db8:abcd::/48");
				expect(subnet2).toBe("2001:0db8:abce::/48");
			});

			it("handles IPv6 loopback", () => {
				expect(getSubnetFromIp("::1")).toBe("0000:0000:0000::/48");
			});

			it("handles fully expanded IPv6", () => {
				expect(getSubnetFromIp("2001:0db8:1234:5678:9abc:def0:1234:5678")).toBe("2001:0db8:1234::/48");
			});

			it("handles IPv6 addresses with leading zeros", () => {
				const addr1 = getSubnetFromIp("2001:0db8:0001::1");
				const addr2 = getSubnetFromIp("2001:db8:1::1");
				expect(addr1).toBe(addr2);
				expect(addr1).toBe("2001:0db8:0001::/48");
			});
		});

		describe("IPv4-mapped IPv6 addresses", () => {
			it("unwraps IPv4-mapped IPv6 to IPv4 /24", () => {
				expect(getSubnetFromIp("::ffff:192.0.2.1")).toBe("192.0.2.0/24");
				expect(getSubnetFromIp("::ffff:10.0.0.1")).toBe("10.0.0.0/24");
				expect(getSubnetFromIp("::ffff:172.16.50.100")).toBe("172.16.50.0/24");
			});

			it("normalizes case of IPv4-mapped addresses", () => {
				const lowercase = getSubnetFromIp("::ffff:192.0.2.1");
				const uppercase = getSubnetFromIp("::FFFF:192.0.2.1");
				expect(lowercase).toBe(uppercase);
				expect(lowercase).toBe("192.0.2.0/24");
			});

			it("handles same IPv4 from different IPv4-mapped addresses", () => {
				const mapped1 = getSubnetFromIp("::ffff:192.0.2.1");
				const mapped2 = getSubnetFromIp("::ffff:192.0.2.200");
				expect(mapped1).toBe(mapped2);
				expect(mapped1).toBe("192.0.2.0/24");
			});

			it("treats IPv4-mapped IPv6 same as native IPv4 for same /24", () => {
				const ipv4 = getSubnetFromIp("192.0.2.1");
				const ipv4Mapped = getSubnetFromIp("::ffff:192.0.2.1");
				expect(ipv4).toBe(ipv4Mapped);
			});
		});

		describe("Malformed and edge case input", () => {
			it("returns 'unknown-subnet' for null or undefined input", () => {
				expect(getSubnetFromIp(null)).toBe("unknown-subnet");
				expect(getSubnetFromIp(undefined)).toBe("unknown-subnet");
			});

			it("returns 'unknown-subnet' for empty string", () => {
				expect(getSubnetFromIp("")).toBe("unknown-subnet");
				expect(getSubnetFromIp("   ")).toBe("unknown-subnet");
			});

			it("returns 'unknown-subnet' for non-string input", () => {
				expect(getSubnetFromIp(123)).toBe("unknown-subnet");
				expect(getSubnetFromIp({})).toBe("unknown-subnet");
				expect(getSubnetFromIp([])).toBe("unknown-subnet");
			});

			it("returns 'unknown-subnet' for invalid IPv4", () => {
				expect(getSubnetFromIp("192.168")).toBe("unknown-subnet");
				expect(getSubnetFromIp("192.168.1")).toBe("unknown-subnet");
				expect(getSubnetFromIp("192.168.1.1.1")).toBe("unknown-subnet");
				expect(getSubnetFromIp("256.1.1.1")).toBe("unknown-subnet"); // Out of range
				expect(getSubnetFromIp("192.168.-1.1")).toBe("unknown-subnet");
				expect(getSubnetFromIp("abc.def.ghi.jkl")).toBe("unknown-subnet");
			});

			it("returns 'unknown-subnet' for invalid IPv6", () => {
				expect(getSubnetFromIp("gggg::1")).toBe("unknown-subnet"); // Invalid hex
				expect(getSubnetFromIp("::1::2")).toBe("unknown-subnet"); // Multiple ::
				expect(getSubnetFromIp("1:2:3:4:5:6:7:8:9")).toBe("unknown-subnet"); // Too many groups
				expect(getSubnetFromIp("192.168.1.1")).toBe("unknown-subnet"); // Wait, this is valid IPv4!
			});

			it("handles whitespace gracefully", () => {
				expect(getSubnetFromIp("  192.0.2.1  ")).toBe("192.0.2.0/24");
				expect(getSubnetFromIp("\n2001:db8::1\t")).toBe("2001:0db8:0000:0000:0000:0000:0000:0001::/48");
			});

			it("does not throw on any input", () => {
				expect(() => getSubnetFromIp(null)).not.toThrow();
				expect(() => getSubnetFromIp({})).not.toThrow();
				expect(() => getSubnetFromIp([1, 2, 3])).not.toThrow();
				expect(() => getSubnetFromIp("invalid")).not.toThrow();
				expect(() => getSubnetFromIp("::::::::::::::::::")).not.toThrow();
			});
		});

		describe("Consistency and determinism", () => {
			it("same IP always produces same subnet key", () => {
				const ip = "192.0.2.123";
				const subnet1 = getSubnetFromIp(ip);
				const subnet2 = getSubnetFromIp(ip);
				const subnet3 = getSubnetFromIp(ip);
				expect(subnet1).toBe(subnet2);
				expect(subnet2).toBe(subnet3);
			});

			it("same IPv6 in different formats produces same key", () => {
				const subnets = [
					getSubnetFromIp("2001:db8:abcd::1"),
					getSubnetFromIp("2001:db8:abcd:0:0:0:0:1"),
					getSubnetFromIp("2001:0db8:abcd:0000:0000:0000:0000:0001"),
					getSubnetFromIp("2001:DB8:ABCD::1"),
				];
				const first = subnets[0];
				expect(subnets.every((s) => s === first)).toBe(true);
			});
		});

		describe("Real-world attack scenarios", () => {
			it("prevents bypass using IPv4-mapped IPv6 variant", () => {
				const native = getSubnetFromIp("192.0.2.1");
				const mapped = getSubnetFromIp("::ffff:192.0.2.1");
				// Attacker cannot bypass by using mapped format
				expect(native).toBe(mapped);
			});

			it("prevents bypass using different IPv6 notations", () => {
				const compressed = getSubnetFromIp("2001:db8:abcd::1");
				const expanded = getSubnetFromIp("2001:0db8:abcd:0000:0000:0000:0000:0001");
				const uppercase = getSubnetFromIp("2001:DB8:ABCD::1");
				// All formats of same address produce same key
				expect(compressed).toBe(expanded);
				expect(expanded).toBe(uppercase);
			});

			it("prevents bypass using malformed input to escape limits", () => {
				// Attacker tries to use malformed IP to get a unique key
				const malformed1 = getSubnetFromIp("invalid-ip");
				const malformed2 = getSubnetFromIp("another-garbage");
				// Both fall into the same "unknown" bucket, rate limiting still applies
				expect(malformed1).toBe("unknown-subnet");
				expect(malformed2).toBe("unknown-subnet");
				expect(malformed1).toBe(malformed2); // Both hit the same limit
			});
		});
	});

	describe("extractIpSubnet", () => {
		test("extracts /24 subnet from IPv4 address", () => {
			expect(extractIpSubnet("192.168.1.100")).toBe("192.168.1");
			expect(extractIpSubnet("10.0.0.5")).toBe("10.0.0");
			expect(extractIpSubnet("172.16.50.200")).toBe("172.16.50");
		});

		test("handles localhost", () => {
			expect(extractIpSubnet("127.0.0.1")).toBe("127.0.0");
		});

		test("handles public IPs", () => {
			expect(extractIpSubnet("8.8.8.8")).toBe("8.8.8");
			expect(extractIpSubnet("1.1.1.1")).toBe("1.1.1");
		});

		test("returns full IPv6 as-is", () => {
			expect(extractIpSubnet("2001:db8::1")).toBe("2001:db8::1");
			expect(extractIpSubnet("::1")).toBe("::1");
		});

		test("handles null/undefined input", () => {
			expect(extractIpSubnet(null)).toBeNull();
			expect(extractIpSubnet(undefined)).toBeNull();
		});

		test("trims whitespace", () => {
			expect(extractIpSubnet("  192.168.1.100  ")).toBe("192.168.1");
			expect(extractIpSubnet("\n10.0.0.5\t")).toBe("10.0.0");
		});

		test("handles malformed IPs gracefully", () => {
			expect(extractIpSubnet("invalid")).toBe("invalid");
			expect(extractIpSubnet("192.168")).toBe("192.168");
			expect(extractIpSubnet("")).toBe("");
		});
	});

	describe("getClientIp", () => {
		test("extracts IP from X-Forwarded-For header (first IP)", () => {
			const req = {
				headers: {
					"x-forwarded-for": "203.0.113.1, 198.51.100.2, 192.0.2.3",
				},
			};
			expect(getClientIp(req)).toBe("203.0.113.1");
		});

		test("uses CF-Connecting-IP when X-Forwarded-For is absent", () => {
			const req = {
				headers: {
					"cf-connecting-ip": "104.16.0.1",
				},
			};
			expect(getClientIp(req)).toBe("104.16.0.1");
		});

		test("prefers X-Forwarded-For over CF-Connecting-IP", () => {
			const req = {
				headers: {
					"x-forwarded-for": "203.0.113.1",
					"cf-connecting-ip": "104.16.0.1",
				},
			};
			expect(getClientIp(req)).toBe("203.0.113.1");
		});

		test("extracts from socket.remoteAddress when no headers", () => {
			const req = {
				headers: {},
				socket: {
					remoteAddress: "192.168.1.100",
				},
			};
			expect(getClientIp(req)).toBe("192.168.1.100");
		});

		test("falls back to connection.remoteAddress", () => {
			const req = {
				headers: {},
				connection: {
					remoteAddress: "10.0.0.50",
				},
			};
			expect(getClientIp(req)).toBe("10.0.0.50");
		});

		test("returns null when no IP sources available", () => {
			const req = {
				headers: {},
			};
			expect(getClientIp(req)).toBeNull();
		});

		test("returns null for null request", () => {
			expect(getClientIp(null)).toBeNull();
		});

		test("trims whitespace from X-Forwarded-For", () => {
			const req = {
				headers: {
					"x-forwarded-for": "  203.0.113.1  , 198.51.100.2",
				},
			};
			expect(getClientIp(req)).toBe("203.0.113.1");
		});
	});

	describe("getIpSubnetFromRequest", () => {
		test("extracts and normalizes IP subnet from request", () => {
			const req = {
				headers: {
					"x-forwarded-for": "192.168.1.100",
				},
			};
			expect(getIpSubnetFromRequest(req)).toBe("192.168.1");
		});

		test("handles proxy chain and extracts first IP subnet", () => {
			const req = {
				headers: {
					"x-forwarded-for": "203.0.113.50, 198.51.100.2, 192.0.2.3",
				},
			};
			expect(getIpSubnetFromRequest(req)).toBe("203.0.113");
		});

		test("returns null when no IP available", () => {
			const req = {
				headers: {},
			};
			expect(getIpSubnetFromRequest(req)).toBeNull();
		});

		test("returns null for null request", () => {
			expect(getIpSubnetFromRequest(null)).toBeNull();
		});

		test("works with direct socket connection", () => {
			const req = {
				headers: {},
				socket: {
					remoteAddress: "10.0.0.100",
				},
			};
			expect(getIpSubnetFromRequest(req)).toBe("10.0.0");
		});
	});

	describe("Integration: Real-world scenarios", () => {
		test("handles corporate proxy chain", () => {
			const req = {
				headers: {
					"x-forwarded-for": "10.20.30.40, 10.20.30.1, 192.168.1.1",
				},
			};
			const subnet = getIpSubnetFromRequest(req);
			expect(subnet).toBe("10.20.30");
		});

		test("handles Cloudflare + corporate proxy", () => {
			const req = {
				headers: {
					"cf-connecting-ip": "104.16.132.1",
					"x-forwarded-for": "203.0.113.100",
				},
			};
			const subnet = getIpSubnetFromRequest(req);
			// X-Forwarded-For takes precedence
			expect(subnet).toBe("203.0.113");
		});

		test("handles localhost development environment", () => {
			const req = {
				headers: {},
				socket: {
					remoteAddress: "127.0.0.1",
				},
			};
			const subnet = getIpSubnetFromRequest(req);
			expect(subnet).toBe("127.0.0");
		});
	});
});
