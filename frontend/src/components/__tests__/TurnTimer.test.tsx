import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import GameTimer from "../TurnTimer";

function render(secondsLeft: number, totalSeconds: number): string {
	return renderToStaticMarkup(
		<GameTimer secondsLeft={secondsLeft} totalSeconds={totalSeconds} />,
	);
}

describe("GameTimer (TurnTimer)", () => {
	describe("time formatting", () => {
		it("formats minutes and zero-padded seconds", () => {
			expect(render(65, 300)).toContain("1:05");
		});

		it("formats a sub-minute value with a leading zero minute", () => {
			expect(render(9, 300)).toContain("0:09");
		});

		it("renders 0:00 at zero", () => {
			expect(render(0, 300)).toContain("0:00");
		});

		it("clamps negative time to 0:00 rather than showing a negative value", () => {
			const markup = render(-5, 300);
			expect(markup).toContain("0:00");
			expect(markup).not.toContain("-");
		});
	});

	describe("urgency state", () => {
		it("applies the urgent red style at or below 60 seconds", () => {
			const markup = render(45, 300);
			expect(markup).toContain("text-red-500");
			expect(markup).toContain("animate-pulse");
		});

		it("does not apply the urgent pulse above 60 seconds", () => {
			const markup = render(120, 300);
			expect(markup).not.toContain("animate-pulse");
		});
	});

	describe("progress bar", () => {
		it("renders a proportional width for the remaining time", () => {
			expect(render(150, 300)).toContain("width:50%");
		});

		it("guards against a zero total (no division by zero)", () => {
			const markup = render(30, 0);
			expect(markup).toContain("width:0%");
		});
	});
});
