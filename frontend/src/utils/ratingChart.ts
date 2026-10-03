import type { RatingPoint } from "../api/profileApi";

export const CHART_WIDTH = 500;
export const CHART_HEIGHT = 180;
export const CHART_PADDING = { top: 10, right: 12, bottom: 20, left: 40 } as const;
export const MAX_CHART_POINTS = 30;

export interface ChartPoint extends RatingPoint {
	x: number;
	y: number;
}

export interface RatingChartGeometry {
	points: ChartPoint[];
	/** SVG path for the rating line. Empty when there are no points. */
	linePath: string;
	/** Closed SVG path for the shaded area under the line. */
	areaPath: string;
	yTicks: { y: number; value: number }[];
	minRating: number;
	maxRating: number;
}

/** Picks a "nice" tick step (1, 2, 5 × 10^n) so there are about `targetTicks` intervals. */
export function niceStep(range: number, targetTicks = 3): number {
	if (!(range > 0)) return 10;
	const rough = range / targetTicks;
	const magnitude = 10 ** Math.floor(Math.log10(rough));
	const normalized = rough / magnitude;
	const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
	return nice * magnitude;
}

const round = (n: number) => Math.round(n * 100) / 100;

export interface RatingChartOptions {
	/** Chart width in SVG units (the component passes its rendered pixel width). */
	width?: number;
	height?: number;
	maxPoints?: number;
}

/**
 * Lays out the most recent `maxPoints` ratings inside a width x height viewBox.
 * Points are spaced evenly per game; the y-axis snaps to round rating values
 * and always spans at least 20 points so a flat history is still readable.
 */
export function buildRatingChart(
	history: RatingPoint[],
	{ width = CHART_WIDTH, height = CHART_HEIGHT, maxPoints = MAX_CHART_POINTS }: RatingChartOptions = {},
): RatingChartGeometry {
	const recent = history.slice(-maxPoints);
	const plotLeft = CHART_PADDING.left;
	const plotRight = width - CHART_PADDING.right;
	const plotTop = CHART_PADDING.top;
	const plotBottom = height - CHART_PADDING.bottom;

	if (recent.length === 0) {
		return { points: [], linePath: "", areaPath: "", yTicks: [], minRating: 0, maxRating: 0 };
	}

	const ratings = recent.map((p) => p.rating);
	let low = Math.min(...ratings);
	let high = Math.max(...ratings);
	if (high - low < 20) {
		const mid = (high + low) / 2;
		low = mid - 10;
		high = mid + 10;
	}

	const step = niceStep(high - low);
	const domainMin = Math.floor(low / step) * step;
	const domainMax = Math.ceil(high / step) * step;
	const domainRange = domainMax - domainMin || step;

	const yFor = (rating: number) =>
		round(plotBottom - ((rating - domainMin) / domainRange) * (plotBottom - plotTop));
	const xFor = (index: number) =>
		recent.length === 1
			? round((plotLeft + plotRight) / 2)
			: round(plotLeft + (index / (recent.length - 1)) * (plotRight - plotLeft));

	const points = recent.map((p, i) => ({ ...p, x: xFor(i), y: yFor(p.rating) }));

	const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");
	const areaPath =
		points.length > 1
			? `${linePath} L${points[points.length - 1].x} ${plotBottom} L${points[0].x} ${plotBottom} Z`
			: "";

	const yTicks: { y: number; value: number }[] = [];
	for (let value = domainMin; value <= domainMax + step / 2; value += step) {
		yTicks.push({ value: round(value), y: yFor(value) });
	}

	return {
		points,
		linePath,
		areaPath,
		yTicks,
		minRating: Math.min(...ratings),
		maxRating: Math.max(...ratings),
	};
}
