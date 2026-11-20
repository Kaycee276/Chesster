import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { render as rtlRender, screen } from "@testing-library/react";
import GameTimer from "../TurnTimer";
import { announcementThreshold, describeDuration } from "../../utils/timeControl";

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

		it("formats tenths of a second below ten seconds", () => {
			expect(render(8.45, 300)).toContain("0:08.4");
			expect(render(10, 300)).toContain("0:10");
		});

		it("renders tenths at zero", () => {
			expect(render(0, 300)).toContain("0:00.0");
		});

		it("clamps negative time rather than showing a negative value", () => {
			const markup = render(-5, 300);
			expect(markup).toContain("0:00.0");
			expect(markup).not.toContain("-0:");
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

	describe("accessibility (#646)", () => {
		it("exposes role=timer with a natural-language label", () => {
			const markup = renderToStaticMarkup(
				<GameTimer secondsLeft={105} totalSeconds={300} playerLabel="White" />,
			);
			expect(markup).toContain('role="timer"');
			expect(markup).toContain('aria-label="White remaining time: 1 minute 45 seconds"');
		});

		it("falls back to a generic label without a player label", () => {
			expect(render(60, 300)).toContain('aria-label="Time remaining: 1 minute"');
		});

		it("describes durations with correct pluralisation", () => {
			expect(describeDuration(1000)).toBe("1 second");
			expect(describeDuration(61_000)).toBe("1 minute 1 second");
			expect(describeDuration(120_000)).toBe("2 minutes");
			expect(describeDuration(-5)).toBe("0 seconds");
			expect(describeDuration(Number.NaN)).toBe("0 seconds");
		});

		it("maps remaining time to the tightest announcement threshold", () => {
			expect(announcementThreshold(31_000)).toBeNull();
			expect(announcementThreshold(30_000)).toBe(30);
			expect(announcementThreshold(29_500)).toBe(30);
			expect(announcementThreshold(10_000)).toBe(10);
			expect(announcementThreshold(5_000)).toBe(5);
			expect(announcementThreshold(0)).toBe(5);
		});

		it("renders an assertive, empty alert region above the thresholds", () => {
			const markup = render(120, 300);
			expect(markup).toContain('role="alert"');
			expect(markup).toContain('aria-live="assertive"');
			expect(markup).not.toContain("Warning:");
		});

		it("announces once per threshold crossing, including skipped seconds", () => {
			const { rerender } = rtlRender(<GameTimer secondsLeft={45} totalSeconds={300} />);
			const alert = () => screen.getByRole("alert");
			expect(alert().textContent).toBe("");

			rerender(<GameTimer secondsLeft={30} totalSeconds={300} />);
			expect(alert().textContent).toBe("Warning: 30 seconds or less remaining");

			// Re-render within the same bucket: text unchanged, so no new announcement.
			rerender(<GameTimer secondsLeft={22} totalSeconds={300} />);
			expect(alert().textContent).toBe("Warning: 30 seconds or less remaining");

			// Update skips exactly 10s (11 -> 9): lands in the 10s bucket.
			rerender(<GameTimer secondsLeft={9} totalSeconds={300} />);
			expect(alert().textContent).toBe("Warning: 10 seconds or less remaining");

			rerender(<GameTimer secondsLeft={5} totalSeconds={300} />);
			expect(alert().textContent).toBe("Warning: 5 seconds or less remaining");
		});

		it("stays silent while the clock is paused", () => {
			rtlRender(<GameTimer secondsLeft={8} totalSeconds={300} isClockRunning={false} />);
			expect(screen.getByRole("alert").textContent).toBe("");
		});
	});
});
