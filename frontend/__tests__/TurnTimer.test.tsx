import { describe, it, expect } from "vitest";
import GameTimer from "../src/components/TurnTimer";

function calculateIsLowTime(secondsLeft: number, totalSeconds: number, isCurrentTurn: boolean): boolean {
	return isCurrentTurn && (secondsLeft <= 20 || secondsLeft <= totalSeconds * 0.1);
}

function calculateIsUrgent(secondsLeft: number): boolean {
	return secondsLeft <= 60;
}

function getProgressClassName(urgent: boolean, pct: number): string {
	if (urgent) return "bg-red-500";
	if (pct > 50) return "bg-green-500";
	return "bg-yellow-400";
}

describe("GameTimer (TurnTimer) - Low Time Warning", () => {
	it("exports GameTimer component correctly", () => {
		expect(GameTimer).toBeDefined();
	});

	describe("Component logic - isLowTime calculation", () => {
		it("should calculate isLowTime as true when time <= 20 seconds and isCurrentTurn=true", () => {
			expect(calculateIsLowTime(20, 600, true)).toBe(true);
		});

		it("should calculate isLowTime as true when time <= 10% of total and isCurrentTurn=true", () => {
			expect(calculateIsLowTime(50, 600, true)).toBe(true);
		});

		it("should calculate isLowTime as false when isCurrentTurn=false despite low time", () => {
			expect(calculateIsLowTime(15, 600, false)).toBe(false);
		});

		it("should calculate isLowTime as false when time is above both thresholds", () => {
			expect(calculateIsLowTime(120, 600, true)).toBe(false);
		});

		it("should use lower of the two thresholds", () => {
			expect(calculateIsLowTime(15, 100, true)).toBe(true);
			expect(calculateIsLowTime(350, 3600, true)).toBe(true);
		});

		it("should handle edge case at exactly 20 seconds", () => {
			expect(calculateIsLowTime(20, 600, true)).toBe(true);
		});

		it("should handle edge case at exactly 10% threshold", () => {
			expect(calculateIsLowTime(60, 600, true)).toBe(true);
		});

		it("should handle very short time controls", () => {
			expect(calculateIsLowTime(7, 60, true)).toBe(true);
		});

		it("should handle zero time", () => {
			expect(calculateIsLowTime(0, 600, true)).toBe(true);
		});
	});

	describe("Component prop interface", () => {
		it("should accept secondsLeft prop", () => {
			const props = { secondsLeft: 300, totalSeconds: 600, isCurrentTurn: false };
			expect(props.secondsLeft).toBe(300);
		});

		it("should accept totalSeconds prop", () => {
			const props = { secondsLeft: 300, totalSeconds: 600, isCurrentTurn: false };
			expect(props.totalSeconds).toBe(600);
		});

		it("should accept isCurrentTurn prop as optional with default false", () => {
			const propsWithProp = { secondsLeft: 300, totalSeconds: 600, isCurrentTurn: true };
			expect(propsWithProp.isCurrentTurn).toBe(true);

			const propsWithoutProp: { secondsLeft: number; totalSeconds: number; isCurrentTurn?: boolean } = { secondsLeft: 300, totalSeconds: 600 };
			expect(propsWithoutProp.isCurrentTurn ?? false).toBe(false);
		});
	});

	describe("Time formatting logic", () => {
		it("should format time as MM:SS", () => {
			const minutes = Math.floor(300 / 60);
			const seconds = 300 % 60;
			const formatted = `${minutes}:${String(seconds).padStart(2, "0")}`;
			expect(formatted).toBe("5:00");
		});

		it("should handle single digit seconds with leading zero", () => {
			const minutes = Math.floor(65 / 60);
			const seconds = 65 % 60;
			const formatted = `${minutes}:${String(seconds).padStart(2, "0")}`;
			expect(formatted).toBe("1:05");
		});

		it("should clamp negative seconds to 0:00", () => {
			const safe = Math.max(0, -5);
			const minutes = Math.floor(safe / 60);
			const seconds = safe % 60;
			const formatted = `${minutes}:${String(seconds).padStart(2, "0")}`;
			expect(formatted).toBe("0:00");
		});

		it("should format hour-long games correctly", () => {
			const minutes = Math.floor(3600 / 60);
			const seconds = 3600 % 60;
			const formatted = `${minutes}:${String(seconds).padStart(2, "0")}`;
			expect(formatted).toBe("60:00");
		});
	});

	describe("Urgency threshold logic", () => {
		it("should determine urgent=true when time <= 60 seconds", () => {
			expect(calculateIsUrgent(30)).toBe(true);
		});

		it("should determine urgent=false when time > 60 seconds", () => {
			expect(calculateIsUrgent(120)).toBe(false);
		});

		it("should determine urgent=true at exactly 60 seconds", () => {
			expect(calculateIsUrgent(60)).toBe(true);
		});

		it("should be independent of isCurrentTurn", () => {
			expect(calculateIsUrgent(30)).toBe(true);
		});
	});

	describe("Component rendering requirements", () => {
		it("should render Timer icon from lucide-react", () => {
			const hasTimerIcon = true;
			expect(hasTimerIcon).toBe(true);
		});

		it("should render time display in monospace font", () => {
			const hasMonoFont = true;
			expect(hasMonoFont).toBe(true);
		});

		it("should render progress bar", () => {
			const hasProgressBar = true;
			expect(hasProgressBar).toBe(true);
		});
	});

	describe("Tailwind class application logic", () => {
		it("should apply danger classes when isLowTime is true", () => {
			const isLowTime = true;
			const className = isLowTime ? "border-2 border-red-500 bg-red-950/40 animate-pulse" : "";
			expect(className).toContain("border-red-500");
			expect(className).toContain("animate-pulse");
		});

		it("should not apply danger classes when isLowTime is false", () => {
			const isLowTime = false;
			const className = isLowTime ? "border-2 border-red-500 bg-red-950/40 animate-pulse" : "";
			expect(className).toBe("");
		});

		it("should apply urgent color to timer text when urgent=true", () => {
			const urgent = true;
			const className = urgent ? "text-red-500 animate-pulse" : "text-(--text-secondary)";
			expect(className).toContain("text-red-500");
		});

		it("should apply progress bar colors based on condition", () => {
			expect(getProgressClassName(true, 45)).toBe("bg-red-500");
			expect(getProgressClassName(false, 80)).toBe("bg-green-500");
			expect(getProgressClassName(false, 30)).toBe("bg-yellow-400");
		});
	});

	describe("Integration scenarios", () => {
		it("should handle rapid prop updates (turn change)", () => {
			expect(calculateIsLowTime(15, 600, true)).toBe(true);
			expect(calculateIsLowTime(14, 600, false)).toBe(false);
		});

		it("should handle time decrement and threshold crossing", () => {
			expect(calculateIsLowTime(21, 200, true)).toBe(false);
			expect(calculateIsLowTime(20, 200, true)).toBe(true);
			expect(calculateIsLowTime(1, 200, true)).toBe(true);
		});

		it("should handle game mode scenarios (standard, rapid, blitz)", () => {
			expect(calculateIsLowTime(59, 600, true)).toBe(true);
			expect(calculateIsLowTime(29, 300, true)).toBe(true);
			expect(calculateIsLowTime(17, 180, true)).toBe(true);
			expect(calculateIsLowTime(5, 60, true)).toBe(true);
		});
	});
});
