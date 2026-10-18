import { useState } from "react";
import { formatEvaluation } from "../utils/engineEvaluation";

interface EvaluationGraphProps {
	evaluations: readonly (number | null)[];
	currentMoveIndex: number;
	onMoveChange: (index: number) => void;
}

interface Point {
	index: number;
	x: number;
	y: number;
	score: number;
}

const WIDTH = 640;
const HEIGHT = 144;
const PADDING_X = 12;
const PADDING_Y = 16;
const ZERO_Y = HEIGHT / 2;
const SCORE_RANGE = 500;

function positionLabel(index: number): string {
	if (index === 0) return "Starting position";
	const side = index % 2 === 1 ? "White" : "Black";
	return `Move ${Math.ceil(index / 2)} after ${side}`;
}

function createPoints(evaluations: readonly (number | null)[]): Point[] {
	const width = WIDTH - PADDING_X * 2;
	const height = HEIGHT - PADDING_Y * 2;
	const denominator = Math.max(evaluations.length - 1, 1);

	return evaluations.flatMap((score, index) => {
		if (score === null || !Number.isFinite(score)) return [];
		const normalized = Math.max(-1, Math.min(1, score / SCORE_RANGE));
		return [{
			index,
			x: PADDING_X + (index / denominator) * width,
			y: ZERO_Y - normalized * (height / 2),
			score,
		}];
	});
}

function createAreaPaths(points: readonly (Point | undefined)[]): { white: string[]; black: string[] } {
	const white: string[] = [];
	const black: string[] = [];
	for (let index = 1; index < points.length; index += 1) {
		const left = points[index - 1];
		const right = points[index];
		if (!left || !right) continue;

		const leftScore = Math.max(-SCORE_RANGE, Math.min(SCORE_RANGE, left.score));
		const rightScore = Math.max(-SCORE_RANGE, Math.min(SCORE_RANGE, right.score));
		const leftPositive = leftScore >= 0;
		const rightPositive = rightScore >= 0;

		if (leftPositive === rightPositive) {
			const path = `M ${left.x} ${ZERO_Y} L ${left.x} ${left.y} L ${right.x} ${right.y} L ${right.x} ${ZERO_Y} Z`;
			(leftPositive ? white : black).push(path);
			continue;
		}

		const fraction = Math.abs(leftScore) / (Math.abs(leftScore) + Math.abs(rightScore));
		const crossingX = left.x + (right.x - left.x) * fraction;
		const leftPath = `M ${left.x} ${ZERO_Y} L ${left.x} ${left.y} L ${crossingX} ${ZERO_Y} Z`;
		const rightPath = `M ${crossingX} ${ZERO_Y} L ${right.x} ${right.y} L ${right.x} ${ZERO_Y} Z`;
		(leftPositive ? white : black).push(leftPath);
		(rightPositive ? white : black).push(rightPath);
	}
	return { white, black };
}

export default function EvaluationGraph({
	evaluations,
	currentMoveIndex,
	onMoveChange,
}: EvaluationGraphProps) {
	const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
	const points = createPoints(evaluations);
	const pointByIndex = new Map(points.map((point) => [point.index, point]));
	const areaPaths = createAreaPaths(evaluations.map((_, index) => pointByIndex.get(index)));
	const linePaths = points.slice(1).flatMap((point, index) => {
		const previous = points[index];
		return previous.index === point.index - 1
			? [`M ${previous.x} ${previous.y} L ${point.x} ${point.y}`]
			: [];
	});
	const hoveredPoint = hoveredIndex === null ? undefined : pointByIndex.get(hoveredIndex);

	const selectPoint = (index: number) => onMoveChange(index - 1);
	const handlePointKeyDown = (event: React.KeyboardEvent<SVGGElement>, index: number) => {
		if (event.key !== "Enter" && event.key !== " ") return;
		event.preventDefault();
		selectPoint(index);
	};

	return (
		<section className="shrink-0 rounded-xl bg-(--bg-secondary) border border-(--border) p-2.5">
			<div className="mb-1 flex items-center justify-between">
				<h2 className="text-[10px] font-semibold uppercase tracking-wide text-(--accent-primary)">
					Move evaluation
				</h2>
				{hoveredPoint && (
					<span className="text-[10px] font-mono text-(--text-secondary)" aria-live="polite">
						{positionLabel(hoveredPoint.index)} · {formatEvaluation(hoveredPoint.score)}
					</span>
				)}
			</div>
			{points.length === 0 ? (
				<p className="py-4 text-center text-[10px] text-(--text-tertiary)" role="status">
					Evaluation graph is loading.
				</p>
			) : (
				<svg
					viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
					className="block h-28 w-full overflow-visible rounded-lg bg-(--bg)"
					role="group"
					aria-label="Interactive move evaluation graph, from plus five to minus five pawns"
				>
					<path d={areaPaths.white.join(" ")} fill="#4ade80" fillOpacity="0.22" data-testid="white-advantage-area" />
					<path d={areaPaths.black.join(" ")} fill="#f87171" fillOpacity="0.22" data-testid="black-advantage-area" />
					<line
						x1={PADDING_X}
						x2={WIDTH - PADDING_X}
						y1={ZERO_Y}
						y2={ZERO_Y}
						stroke="currentColor"
						strokeOpacity="0.45"
						strokeDasharray="4 4"
					/>
					{linePaths.map((path, index) => (
						<path key={index} d={path} fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinejoin="round" />
					))}
					{points.map((point) => {
						const label = `${positionLabel(point.index)}: ${formatEvaluation(point.score)}`;
						return (
							<g
								key={point.index}
								role="button"
								tabIndex={0}
								aria-label={label}
								aria-pressed={currentMoveIndex === point.index - 1}
								onClick={() => selectPoint(point.index)}
								onKeyDown={(event) => handlePointKeyDown(event, point.index)}
								onPointerEnter={() => setHoveredIndex(point.index)}
								onPointerLeave={() => setHoveredIndex(null)}
								onFocus={() => setHoveredIndex(point.index)}
								onBlur={() => setHoveredIndex(null)}
							>
								<title>{label}</title>
								<circle cx={point.x} cy={point.y} r="9" fill="transparent" />
								<circle
									cx={point.x}
									cy={point.y}
									r={currentMoveIndex === point.index - 1 ? 4.5 : 3}
									fill="#93c5fd"
									stroke="#0f172a"
									strokeWidth="1.5"
								/>
							</g>
						);
					})}
				</svg>
			)}
		</section>
	);
}
