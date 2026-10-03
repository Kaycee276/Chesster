import { describe, expect, it } from "vitest";
import { Networks } from "@stellar/stellar-sdk";
import { describeNetwork, isNetworkMismatch } from "./networkUtils";

describe("describeNetwork", () => {
	it("labels known network passphrases", () => {
		expect(describeNetwork(Networks.TESTNET)).toBe("Testnet");
		expect(describeNetwork(Networks.PUBLIC)).toBe("Mainnet");
	});

	it("falls back to the raw passphrase for unknown networks", () => {
		expect(describeNetwork("Some Custom Network ; 2024")).toBe(
			"Some Custom Network ; 2024",
		);
	});

	it("falls back to a generic label when no passphrase is given", () => {
		expect(describeNetwork(null)).toBe("an unknown network");
		expect(describeNetwork(undefined)).toBe("an unknown network");
	});
});

describe("isNetworkMismatch", () => {
	it("returns false when the wallet matches the target network", () => {
		expect(isNetworkMismatch(Networks.TESTNET, Networks.TESTNET)).toBe(false);
	});

	it("returns true when the wallet is on a different network", () => {
		expect(isNetworkMismatch(Networks.PUBLIC, Networks.TESTNET)).toBe(true);
	});

	it("returns false when the wallet network is unknown (nothing to compare)", () => {
		expect(isNetworkMismatch(null, Networks.TESTNET)).toBe(false);
		expect(isNetworkMismatch(undefined, Networks.TESTNET)).toBe(false);
	});
});
