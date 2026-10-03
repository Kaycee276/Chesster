import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import EvaluationBar from "../src/components/EvaluationBar";
import { MATE_SCORE_CP, evaluationToWhitePercent } from "../src/utils/engineEvaluation";

type Props = Parameters<typeof EvaluationBar>[0];

function render(props: Props) {
	const html = renderToStaticMarkup(createElement(EvaluationBar, props));
	const segment = /<div data-testid="evaluation-bar-white" class="([^"]*)" style="height:([\d.]+)%"/.exec(html);
	return { html, whiteClass: segment?.[1] ?? "", whiteHeight: Number(segment?.[2]) };
}

describe("EvaluationBar", () => {
	it("splits the bar evenly for a level position", () => {
		const { html, whiteHeight } = render({ scoreCp: 0, orientation: "white" });
		expect(whiteHeight).toBe(50);
		expect(html).toContain(">0.0<");
	});

	it("sizes White's share with the sigmoid mapping", () => {
		const { whiteHeight, html } = render({ scoreCp: 150, orientation: "white", depth: 12 });
		expect(whiteHeight).toBeCloseTo(evaluationToWhitePercent(150), 5);
		expect(html).toContain(">+1.5<");
		expect(html).toContain("depth 12");
	});

	it("grows White's share from the bottom when viewing as White", () => {
		const { html, whiteClass } = render({ scoreCp: 150, orientation: "white" });
		expect(whiteClass).toContain("bottom-0");
		// White is ahead, so the label sits at White's (bottom) end.
		expect(html).toMatch(/bottom-1[^"]*text-gray-900/);
	});

	it("flips when the board is viewed as Black", () => {
		const { html, whiteHeight, whiteClass } = render({ scoreCp: 150, orientation: "black" });
		expect(whiteClass).toContain("top-0");
		expect(whiteClass).not.toContain("bottom-0");
		// Share is unchanged; only its anchor moves to the top.
		expect(whiteHeight).toBeCloseTo(evaluationToWhitePercent(150), 5);
		expect(html).toMatch(/top-1[^"]*text-gray-900/);
	});

	it("places Black's advantage label on Black's side", () => {
		const { html } = render({ scoreCp: -320, orientation: "white" });
		expect(html).toContain(">-3.2<");
		expect(html).toMatch(/top-1[^"]*text-gray-100/);
	});

	it("fills the bar for a forced mate", () => {
		const white = render({ scoreCp: MATE_SCORE_CP, mate: 4, orientation: "white" });
		expect(white.whiteHeight).toBe(100);
		expect(white.html).toContain(">M4<");

		const black = render({ scoreCp: -MATE_SCORE_CP, mate: -2, orientation: "white" });
		expect(black.whiteHeight).toBe(0);
		expect(black.html).toContain(">-M2<");
	});

	it("shows a neutral placeholder while loading", () => {
		const { html, whiteHeight } = render({ scoreCp: 900, orientation: "white", loading: true });
		expect(whiteHeight).toBe(50);
		expect(html).toContain('aria-busy="true"');
		expect(html).toContain("Evaluating position");
	});

	it("exposes the evaluation to assistive technology", () => {
		const { html } = render({ scoreCp: 150, orientation: "white", depth: 12 });
		expect(html).toContain('role="meter"');
		expect(html).toContain('aria-valuenow="');
		expect(html).toContain("White favoured");
	});

	it("animates height changes", () => {
		expect(render({ scoreCp: 10, orientation: "white" }).html).toContain("transition-[height]");
	});
});
