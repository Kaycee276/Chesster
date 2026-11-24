import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import OpeningPerformanceChart from "../src/components/OpeningPerformanceChart";
import type { OpeningStat } from "../src/utils/profileStats";

afterEach(cleanup);
const stats: OpeningStat[] = [
  { name: "Sicilian Defense", eco: "B20", total: 5, wins: 3, draws: 1, losses: 1, winRate: 60 },
  { name: "Unknown Opening", eco: null, total: 1, wins: 0, draws: 1, losses: 0, winRate: 0 },
];

describe("OpeningPerformanceChart", () => {
  it("handles an empty sample without a fabricated chart", () => {
    render(<OpeningPerformanceChart stats={[]} />);
    expect(screen.getByText("No games played yet")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("exposes games, counts and win rate through hover, focus and tap", () => {
    render(<OpeningPerformanceChart stats={stats} />);
    const row = screen.getByRole("button", { name: /Sicilian Defense.*5 games.*3 wins.*1 draw.*1 loss.*60% win rate/ });
    fireEvent.mouseEnter(row);
    expect(screen.getByRole("tooltip")).toHaveTextContent("5 games");
    expect(screen.getByRole("tooltip")).toHaveTextContent("60% win rate");
    expect(row.getAttribute("aria-describedby")).toBe(screen.getByRole("tooltip").id);
    fireEvent.mouseLeave(row);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.focus(row);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.keyDown(row, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.click(row);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.blur(row);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("clears stale details when a new mode replaces the sample", () => {
    const { rerender } = render(<OpeningPerformanceChart stats={stats} />);
    fireEvent.mouseEnter(screen.getByRole("button", { name: /Sicilian Defense/ }));
    rerender(<OpeningPerformanceChart stats={[stats[1]]} />);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(screen.getByText("Unknown Opening")).toBeInTheDocument();
    expect(screen.queryByText("A00")).not.toBeInTheDocument();
  });
});
