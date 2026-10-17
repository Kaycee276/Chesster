import React from "react";
import type { AnnotationArrow, AnnotationColor, SquareHighlight } from "../types/chess";

export const ANNOTATION_COLORS: Record<AnnotationColor, string> = {
  blue: "#3689e6",
  green: "rgba(34, 197, 94, 0.8)",
  red: "#e0403c",
  yellow: "#e6c729",
};

export interface BoardAnnotationsProps {
  boardPx: number;
  playerColor?: "white" | "black" | null;
  highlights: SquareHighlight[];
  arrows: AnnotationArrow[];
}

export function squareCenterPx(
  row: number,
  col: number,
  boardPx: number,
  playerColor: "white" | "black" | null = "white"
) {
  const rowIndex = playerColor === "black" ? 7 - row : row;
  const colIndex = playerColor === "black" ? 7 - col : col;
  const squareSize = boardPx / 8;
  return {
    x: colIndex * squareSize + squareSize / 2,
    y: rowIndex * squareSize + squareSize / 2,
  };
}

export function BoardAnnotations({
  boardPx,
  playerColor = "white",
  highlights,
  arrows,
}: BoardAnnotationsProps) {
  if (highlights.length === 0 && arrows.length === 0) return null;

  const squareSize = boardPx / 8;

  return (
    <svg
      data-testid="board-annotations"
      className="absolute inset-0 pointer-events-none z-10 w-full h-full"
      width={boardPx}
      height={boardPx}
      style={{ zIndex: 10 }}
    >
      <defs>
        <marker
          id="arrowhead"
          markerWidth="6"
          markerHeight="6"
          refX="3"
          refY="3"
          orient="auto"
        >
          <polygon points="0 0, 6 3, 0 6" fill="rgba(34, 197, 94, 0.8)" />
        </marker>
        {(Object.keys(ANNOTATION_COLORS) as AnnotationColor[]).map((color) => (
          <marker
            key={color}
            id={`board-arrowhead-${color}`}
            markerWidth="6"
            markerHeight="6"
            refX="3"
            refY="3"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <polygon points="0 0, 6 3, 0 6" fill={ANNOTATION_COLORS[color]} />
          </marker>
        ))}
      </defs>

      {highlights.map((h, i) => {
        const c = squareCenterPx(h.row, h.col, boardPx, playerColor);
        return (
          <circle
            key={`h-${i}`}
            data-testid={`highlight-${h.row}-${h.col}`}
            cx={c.x}
            cy={c.y}
            r={squareSize * 0.44}
            fill="none"
            stroke={ANNOTATION_COLORS[h.color] || ANNOTATION_COLORS.green}
            strokeWidth={squareSize * 0.08}
            opacity={0.85}
          />
        );
      })}

      {arrows.map((a, i) => {
        const from = squareCenterPx(a.from[0], a.from[1], boardPx, playerColor);
        const to = squareCenterPx(a.to[0], a.to[1], boardPx, playerColor);

        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const len = Math.hypot(dx, dy) || 1;
        const shorten = squareSize * 0.4;
        const endX = to.x - (dx / len) * shorten;
        const endY = to.y - (dy / len) * shorten;

        return (
          <line
            key={`a-${i}`}
            data-testid={`arrow-${a.from[0]}-${a.from[1]}-${a.to[0]}-${a.to[1]}`}
            x1={from.x}
            y1={from.y}
            x2={endX}
            y2={endY}
            stroke={ANNOTATION_COLORS[a.color] || ANNOTATION_COLORS.green}
            strokeWidth={squareSize * 0.14}
            strokeLinecap="round"
            opacity={0.85}
            markerEnd={a.color ? `url(#board-arrowhead-${a.color})` : "url(#arrowhead)"}
          />
        );
      })}
    </svg>
  );
}
