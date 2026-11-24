import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import EvaluationBar from "./EvaluationBar";
import { evaluationToWhitePercent, MATE_SCORE_CP } from "../utils/engineEvaluation";

describe("EvaluationBar Component (#695)", () => {
  it("defaults to orientation 'white' when omitted", () => {
    render(<EvaluationBar scoreCp={100} />);
    const bar = screen.getByTestId("evaluation-bar-white");
    expect(bar.className).toContain("bottom-0");
  });

  it("grows white from bottom when orientation is 'white'", () => {
    render(<EvaluationBar scoreCp={200} orientation="white" />);
    const bar = screen.getByTestId("evaluation-bar-white");
    expect(bar.className).toContain("bottom-0");
    expect(bar.className).not.toContain("top-0");
    const expectedPercent = evaluationToWhitePercent(200);
    expect(bar.style.height).toBe(`${expectedPercent}%`);
  });

  it("inverts bar to top-0 when orientation is 'black'", () => {
    render(<EvaluationBar scoreCp={200} orientation="black" />);
    const bar = screen.getByTestId("evaluation-bar-white");
    expect(bar.className).toContain("top-0");
    expect(bar.className).not.toContain("bottom-0");
    const expectedPercent = evaluationToWhitePercent(200);
    expect(bar.style.height).toBe(`${expectedPercent}%`);
  });

  it("places label on the side that has the advantage", () => {
    // White is winning, viewing as White -> label at bottom
    const { rerender } = render(<EvaluationBar scoreCp={300} orientation="white" />);
    expect(screen.getByText("+3.0").className).toContain("bottom-1");

    // White is winning, viewing as Black -> White is at top, label at top
    rerender(<EvaluationBar scoreCp={300} orientation="black" />);
    expect(screen.getByText("+3.0").className).toContain("top-1");

    // Black is winning, viewing as Black -> Black is at bottom, label at bottom
    rerender(<EvaluationBar scoreCp={-300} orientation="black" />);
    expect(screen.getByText("-3.0").className).toContain("bottom-1");
  });

  it("renders 50% neutral bar while loading", () => {
    render(<EvaluationBar scoreCp={500} loading={true} />);
    const bar = screen.getByTestId("evaluation-bar-white");
    expect(bar.style.height).toBe("50%");
    expect(screen.getByRole("meter")).toHaveAttribute("aria-busy", "true");
  });

  it("handles mate scores correctly", () => {
    const { rerender } = render(<EvaluationBar scoreCp={MATE_SCORE_CP} mate={2} orientation="white" />);
    expect(screen.getByTestId("evaluation-bar-white").style.height).toBe("100%");
    expect(screen.getByText("M2")).toBeInTheDocument();

    rerender(<EvaluationBar scoreCp={-MATE_SCORE_CP} mate={-1} orientation="white" />);
    expect(screen.getByTestId("evaluation-bar-white").style.height).toBe("0%");
    expect(screen.getByText("-M1")).toBeInTheDocument();
  });
});
