import { useRef, useState } from "react";
import { MOVE_QUALITY_META, type MoveQuality } from "../../utils/moveAccuracy";
import type { EngineEvaluation } from "../../utils/engineEvaluation";
import { formatEvaluation } from "../../utils/engineEvaluation";

interface MoveBadgeProps {
	/** The move quality classification (best, good, inaccuracy, mistake, blunder). */
	quality: MoveQuality;
	/** Centipawn loss for this move. */
	cpl: number;
	/** Evaluation before the move (White's perspective). */
	evalBefore: number | null;
	/** Evaluation after the move (White's perspective). */
	evalAfter: number | null;
	/** Best move or principal variation from the position (for tooltip). */
	bestLine?: string | null;
	/** Whether this is a best move (quality === 'best'), used for optional visual contrast. */
	isBest?: boolean;
}

/**
 * Renders a compact, accessible badge for a move's quality classification.
 *
 * - Badge: colored pill with glyph (!, ✓, ?!, ?, ??), appearing next to move notation
 * - Tooltip: keyboard-accessible (focus + hover trigger), shows classification name,
 *   centipawn loss delta (before → after), and the engine's best line if available
 * - Accessibility: aria-label with full text, aria-describedby linking to tooltip,
 *   keyboard navigation (Escape to close), color + glyph redundancy (not color-only)
 * - Touch: tooltip remains visible on tap, dismissed on blur or Escape
 */
export default function MoveBadge({
	quality,
	cpl,
	evalBefore,
	evalAfter,
	bestLine,
	isBest = false,
}: MoveBadgeProps) {
	const meta = MOVE_QUALITY_META[quality];
	const [tooltipVisible, setTooltipVisible] = useState(false);
	const badgeRef = useRef<HTMLSpanElement>(null);
	const tooltipRef = useRef<HTMLDivElement>(null);

	// Format evaluation delta for display
	const deltaText = (() => {
		if (evalBefore === null || evalAfter === null) return null;
		const before = formatEvaluation(evalBefore);
		const after = formatEvaluation(evalAfter);
		return `${before} → ${after}`;
	})();

	// Build aria-label: "Best move" or "[Quality], lost [cpl] cp", etc.
	const ariaLabel = (() => {
		if (isBest) return `${meta.label} move`;
		return `${meta.label}${cpl > 0 ? `, lost ${cpl} cp` : ""}`;
	})();

	// Build tooltip content
	const tooltipContent = (() => {
		const parts: string[] = [];
		parts.push(meta.label);
		if (cpl > 0) parts.push(`Lost ${cpl} cp`);
		if (deltaText) parts.push(`${deltaText}`);
		if (bestLine) parts.push(`Best: ${bestLine}`);
		return parts.join(" · ");
	})();

	const handleMouseEnter = () => {
		setTooltipVisible(true);
	};

	const handleMouseLeave = () => {
		setTooltipVisible(false);
	};

	const handleFocus = () => {
		setTooltipVisible(true);
	};

	const handleBlur = () => {
		setTooltipVisible(false);
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Escape" && tooltipVisible) {
			e.preventDefault();
			setTooltipVisible(false);
			badgeRef.current?.focus();
		}
	};

	const tooltipId = `move-badge-tooltip-${Math.random().toString(36).slice(2, 9)}`;

	return (
		<span
			ref={badgeRef}
			className={`acc-badge ${meta.className} relative`}
			role="status"
			aria-label={ariaLabel}
			aria-describedby={tooltipVisible ? tooltipId : undefined}
			onMouseEnter={handleMouseEnter}
			onMouseLeave={handleMouseLeave}
			onFocus={handleFocus}
			onBlur={handleBlur}
			onKeyDown={handleKeyDown}
			tabIndex={0}
			title={meta.label}
		>
			{meta.glyph}
			{tooltipVisible && (
				<div
					ref={tooltipRef}
					id={tooltipId}
					role="tooltip"
					className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-2 py-1.5 rounded-lg bg-(--bg-secondary) border border-(--border) shadow-lg whitespace-nowrap text-xs text-(--text) font-normal z-50"
					onKeyDown={handleKeyDown}
				>
					{tooltipContent}
				</div>
			)}
		</span>
	);
}
