import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { RatingPoint } from "../api/profileApi";
import {
	CHART_HEIGHT,
	CHART_PADDING,
	CHART_WIDTH,
	MAX_CHART_POINTS,
	buildRatingChart,
} from "../utils/ratingChart";

interface RatingChartProps {
	history: RatingPoint[];
}

const formatDate = (iso: string) =>
	new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

const formatChange = (change: number) => (change > 0 ? `+${change}` : String(change));

const MIN_CHART_WIDTH = 240;

/**
 * SVG line chart of a player's rating over their most recent games (up to 30).
 * Each game is a hoverable / keyboard-focusable point with a tooltip showing
 * the rating, date and change from the previous game.
 *
 * The chart is laid out in real pixels (its viewBox tracks the rendered width)
 * so labels and points keep the same size on phones and wide screens.
 */
export default function RatingChart({ history }: RatingChartProps) {
	const gradientId = useId();
	const containerRef = useRef<HTMLDivElement>(null);
	const [width, setWidth] = useState(CHART_WIDTH);
	const [activeIndex, setActiveIndex] = useState<number | null>(null);
	const chart = useMemo(() => buildRatingChart(history, { width }), [history, width]);
	const { points } = chart;
	const hasPoints = points.length > 0;

	useEffect(() => {
		const element = containerRef.current;
		if (!element || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(([entry]) => {
			setWidth(Math.max(MIN_CHART_WIDTH, Math.round(entry.contentRect.width)));
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, [hasPoints]);

	if (!hasPoints) {
		return (
			<div className="flex h-48 w-full items-center justify-center rounded-lg border border-(--border) bg-(--bg-secondary) text-sm text-(--text-tertiary)">
				No rated games yet
			</div>
		);
	}

	const first = points[0];
	const last = points[points.length - 1];
	const netChange = last.rating - first.rating;
	const active = activeIndex !== null ? points[activeIndex] : null;
	const activeChange =
		activeIndex !== null && activeIndex > 0 ? points[activeIndex].rating - points[activeIndex - 1].rating : null;
	const plotBottom = CHART_HEIGHT - CHART_PADDING.bottom;

	return (
		<div className="w-full rounded-lg border border-(--border) bg-(--bg-secondary) p-3">
			<div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-xs text-(--text-secondary)">
				<span>
					Last {points.length} {points.length === 1 ? "game" : "games"}
					{history.length > MAX_CHART_POINTS && (
						<span className="text-(--text-tertiary)"> of {history.length}</span>
					)}
				</span>
				<span className="flex gap-3 font-mono">
					<span>
						Peak <span className="text-(--text)">{chart.maxRating}</span>
					</span>
					<span className={netChange > 0 ? "text-green-500" : netChange < 0 ? "text-red-400" : ""}>
						{formatChange(netChange)}
					</span>
				</span>
			</div>

			<div ref={containerRef} className="relative">
				<svg
					className="block w-full overflow-visible"
					style={{ height: CHART_HEIGHT }}
					viewBox={`0 0 ${width} ${CHART_HEIGHT}`}
					role="img"
					aria-label={`Rating history: ${first.rating} to ${last.rating} over the last ${points.length} games`}
				>
					<defs>
						<linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
							<stop offset="0%" stopColor="var(--accent-primary)" stopOpacity="0.35" />
							<stop offset="100%" stopColor="var(--accent-primary)" stopOpacity="0" />
						</linearGradient>
					</defs>

					{/* Horizontal grid lines with rating labels */}
					{chart.yTicks.map((tick) => (
						<g key={tick.value}>
							<line
								x1={CHART_PADDING.left}
								x2={width - CHART_PADDING.right}
								y1={tick.y}
								y2={tick.y}
								stroke="var(--border)"
								strokeDasharray="3 4"
								strokeWidth="1"
							/>
							<text
								x={CHART_PADDING.left - 6}
								y={tick.y}
								textAnchor="end"
								dominantBaseline="middle"
								fontSize="10"
								fill="var(--text-tertiary)"
								fontFamily="monospace"
							>
								{tick.value}
							</text>
						</g>
					))}

					{/* First / last date labels */}
					<text x={first.x} y={CHART_HEIGHT - 4} fontSize="10" fill="var(--text-tertiary)" textAnchor={points.length === 1 ? "middle" : "start"}>
						{formatDate(first.date)}
					</text>
					{points.length > 1 && (
						<text x={last.x} y={CHART_HEIGHT - 4} fontSize="10" fill="var(--text-tertiary)" textAnchor="end">
							{formatDate(last.date)}
						</text>
					)}

					{chart.areaPath && <path d={chart.areaPath} fill={`url(#${gradientId})`} />}
					<path
						d={chart.linePath}
						fill="none"
						stroke="var(--accent-primary)"
						strokeWidth="2"
						strokeLinejoin="round"
						strokeLinecap="round"
					/>

					{active && (
						<line
							x1={active.x}
							x2={active.x}
							y1={CHART_PADDING.top}
							y2={plotBottom}
							stroke="var(--text-tertiary)"
							strokeWidth="1"
						/>
					)}

					{points.map((point, index) => (
						<g
							key={`${point.date}-${index}`}
							tabIndex={0}
							role="button"
							aria-label={`${formatDate(point.date)}: rating ${point.rating}`}
							className="cursor-pointer outline-none"
							onMouseEnter={() => setActiveIndex(index)}
							onMouseLeave={() => setActiveIndex(null)}
							onFocus={() => setActiveIndex(index)}
							onBlur={() => setActiveIndex(null)}
						>
							{/* Larger invisible hit area for easier hovering / tapping */}
							<circle cx={point.x} cy={point.y} r="9" fill="transparent" />
							<circle
								cx={point.x}
								cy={point.y}
								r={activeIndex === index ? 4.5 : 3}
								fill={activeIndex === index ? "var(--accent-primary)" : "var(--bg-secondary)"}
								stroke="var(--accent-primary)"
								strokeWidth="2"
							/>
						</g>
					))}
				</svg>

				{active && (
					<div
						role="tooltip"
						className={`pointer-events-none absolute z-10 -translate-y-full whitespace-nowrap rounded-md border border-(--border) bg-(--bg) px-2 py-1 text-xs shadow-lg ${
							active.x < width * 0.2
								? "translate-x-0"
								: active.x > width * 0.8
									? "-translate-x-full"
									: "-translate-x-1/2"
						}`}
						style={{
							left: `${(active.x / width) * 100}%`,
							top: `calc(${(active.y / CHART_HEIGHT) * 100}% - 8px)`,
						}}
					>
						<div className="font-mono font-bold text-(--text)">
							{active.rating}
							{activeChange !== null && (
								<span className={`ml-1.5 ${activeChange > 0 ? "text-green-500" : activeChange < 0 ? "text-red-400" : "text-(--text-tertiary)"}`}>
									{formatChange(activeChange)}
								</span>
							)}
						</div>
						<div className="text-(--text-tertiary)">{new Date(active.date).toLocaleDateString()}</div>
					</div>
				)}
			</div>
		</div>
	);
}
