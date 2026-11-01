import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BoardAnnotations, squareCenterPx } from "../../src/components/BoardAnnotations";
import type { AnnotationArrow, SquareHighlight } from "../../src/types/chess";

describe("BoardAnnotations Component (Issue #536)", () => {
  it("renders nothing when there are no annotations", () => {
    const { container } = render(
      <BoardAnnotations boardPx={800} playerColor="white" highlights={[]} arrows={[]} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders square highlights correctly", () => {
    const highlights: SquareHighlight[] = [
      { row: 4, col: 4, color: "green" },
      { row: 1, col: 2, color: "red" },
    ];

    render(
      <BoardAnnotations
        boardPx={800}
        playerColor="white"
        highlights={highlights}
        arrows={[]}
      />
    );

    const svg = screen.getByTestId("board-annotations");
    expect(svg).toBeInTheDocument();

    const highlight1 = screen.getByTestId("highlight-4-4");
    expect(highlight1).toBeInTheDocument();
    expect(highlight1.tagName.toLowerCase()).toBe("circle");

    const highlight2 = screen.getByTestId("highlight-1-2");
    expect(highlight2).toBeInTheDocument();
  });

  it("renders arrows with arrowhead marker correctly", () => {
    const arrows: AnnotationArrow[] = [
      { from: [6, 4], to: [4, 4], color: "green" },
    ];

    render(
      <BoardAnnotations
        boardPx={800}
        playerColor="white"
        highlights={[]}
        arrows={arrows}
      />
    );

    const arrow = screen.getByTestId("arrow-6-4-4-4");
    expect(arrow).toBeInTheDocument();
    expect(arrow.tagName.toLowerCase()).toBe("line");
    expect(arrow).toHaveAttribute("marker-end", "url(#board-arrowhead-green)");
  });

  it("calculates squareCenterPx with orientation respect", () => {
    const whiteCenter = squareCenterPx(0, 0, 800, "white");
    expect(whiteCenter).toEqual({ x: 50, y: 50 });

    const blackCenter = squareCenterPx(0, 0, 800, "black");
    expect(blackCenter).toEqual({ x: 750, y: 750 });
  });
});
