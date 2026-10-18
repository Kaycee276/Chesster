import { describe, expect, it } from "vitest";
import { parseOverlayOptions } from "../utils/overlayOptions";

describe("parseOverlayOptions", () => {
	it("enables requested broadcast options and accepts supported themes", () => {
		expect(parseOverlayOptions("?chroma=transparent&eval=true&clocks=true&theme=glass&color=black")).toEqual({
			transparent: true,
			showEvaluation: true,
			showClocks: true,
			theme: "glass",
			color: "black",
		});
	});

	it("uses safe defaults for missing or invalid options", () => {
		expect(parseOverlayOptions("?theme=unknown&eval=1&clocks=false")).toEqual({
			transparent: false,
			showEvaluation: false,
			showClocks: false,
			theme: "neon",
			color: null,
		});
	});
});
