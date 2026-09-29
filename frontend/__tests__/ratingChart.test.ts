import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import RatingChart from "../src/components/RatingChart";
import {
	CHART_HEIGHT,
	CHART_PADDING,
	CHART_WIDTH,
	buildRatingChart,
	niceStep,
} from "../src/utils/ratingChart";
import type { RatingPoint } from "../src/api/profileApi";

const history = (ratings: number[]): RatingPoint[] =>
	ratings.map((rating, i) => ({
		rating,
		date: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
	}));

describe("niceStep", () => {
	it("rounds to 1/2/5 multiples", () => {
		expect(niceStep(90)).toBe(50);
		expect(niceStep(30)).toBe(10);
		expect(niceStep(250)).toBe(100);
		expect(niceStep(0)).toBe(10);
	});
});

describe("buildRatingChart", () => {
	it("returns an empty geometry for no history", () => {
		expect(buildRatingChart([])).toMatchObject({ points: [], linePath: "", areaPath: "", yTicks: [] });
	});

	it("keeps only the most recent 30 games", () => {
		const ratings = Array.from({ length: 45 }, (_, i) => 1200 + i);
		const chart = buildRatingChart(history(ratings));
		expect(chart.points).toHaveLength(30);
		expect(buildRatingChart(history(ratings), { maxPoints: 10 }).points).toHaveLength(10);
		expect(chart.points[0].rating).toBe(1215);
		expect(chart.points[29].rating).toBe(1244);
	});

	it("spans the plot area from left to right", () => {
		const { points } = buildRatingChart(history([1200, 1250, 1230]));
		expect(points[0].x).toBe(CHART_PADDING.left);
		expect(points[2].x).toBe(CHART_WIDTH - CHART_PADDING.right);
		expect(points[1].x).toBeCloseTo((CHART_PADDING.left + CHART_WIDTH - CHART_PADDING.right) / 2, 1);
	});

	it("maps higher ratings higher on the chart and stays inside the plot", () => {
		const { points } = buildRatingChart(history([1200, 1300, 1250]));
		expect(points[1].y).toBeLessThan(points[2].y);
		expect(points[2].y).toBeLessThan(points[0].y);
		for (const p of points) {
			expect(p.y).toBeGreaterThanOrEqual(CHART_PADDING.top);
			expect(p.y).toBeLessThanOrEqual(CHART_HEIGHT - CHART_PADDING.bottom);
		}
	});

	it("builds line and closed area paths", () => {
		const { linePath, areaPath, points } = buildRatingChart(history([1200, 1300]));
		expect(linePath).toBe(`M${points[0].x} ${points[0].y} L${points[1].x} ${points[1].y}`);
		expect(areaPath.startsWith(linePath)).toBe(true);
		expect(areaPath.endsWith("Z")).toBe(true);
	});

	it("uses round tick values that cover the rating range", () => {
		const chart = buildRatingChart(history([1213, 1287, 1245]));
		const values = chart.yTicks.map((t) => t.value);
		expect(values[0]).toBeLessThanOrEqual(1213);
		expect(values[values.length - 1]).toBeGreaterThanOrEqual(1287);
		const step = values[1] - values[0];
		expect([10, 20, 50, 100]).toContain(step);
		expect(values.every((v) => v % step === 0)).toBe(true);
		expect(chart.minRating).toBe(1213);
		expect(chart.maxRating).toBe(1287);
	});

	it("gives a flat history a readable range", () => {
		const chart = buildRatingChart(history([1500, 1500, 1500]));
		expect(chart.yTicks.length).toBeGreaterThanOrEqual(2);
		expect(new Set(chart.points.map((p) => p.y)).size).toBe(1);
	});

	it("lays out within a custom width and height", () => {
		const { points } = buildRatingChart(history([1200, 1300]), { width: 800, height: 200 });
		expect(points[1].x).toBe(800 - CHART_PADDING.right);
		expect(points[0].y).toBe(200 - CHART_PADDING.bottom);
	});

	it("centres a single game", () => {
		const chart = buildRatingChart(history([1500]));
		expect(chart.points[0].x).toBeCloseTo((CHART_PADDING.left + CHART_WIDTH - CHART_PADDING.right) / 2, 1);
		expect(chart.areaPath).toBe("");
	});
});

describe("RatingChart", () => {
	const render = (h: RatingPoint[]) => renderToStaticMarkup(createElement(RatingChart, { history: h }));

	it("shows an empty state without history", () => {
		expect(render([])).toContain("No rated games yet");
	});

	it("renders an SVG line with one focusable point per game", () => {
		const html = render(history([1200, 1240, 1220, 1260]));
		expect(html).toContain(`viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}"`);
		expect(html).toContain('aria-label="Rating history: 1200 to 1260 over the last 4 games"');
		expect(html.match(/role="button"/g)).toHaveLength(4);
		expect(html.match(/tabindex="0"/g)).toHaveLength(4);
		expect(html).toContain("Peak <span");
		expect(html).toContain(">+60<");
	});

	it("notes when older games are hidden", () => {
		const html = render(history(Array.from({ length: 40 }, (_, i) => 1200 + i)));
		expect(html).toContain("Last 30 games");
		expect(html).toContain(" of 40");
	});
});
