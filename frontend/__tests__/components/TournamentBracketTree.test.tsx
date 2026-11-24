import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  TournamentBracketTree,
  type TreeMatch,
} from "../../src/components/TournamentBracketTree";
import { getRoundTierTitle } from "../../src/utils/tournamentBracket";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string) => defaultValue || key,
  }),
}));

describe("TournamentBracketTree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calculates round tiers (Round of 16, Quarterfinals, Semifinals, Finals) correctly", () => {
    expect(getRoundTierTitle(0, 4)).toBe("Round of 16");
    expect(getRoundTierTitle(1, 4)).toBe("Quarterfinals");
    expect(getRoundTierTitle(2, 4)).toBe("Semifinals");
    expect(getRoundTierTitle(3, 4)).toBe("Finals");

    expect(getRoundTierTitle(0, 3)).toBe("Quarterfinals");
    expect(getRoundTierTitle(1, 3)).toBe("Semifinals");
    expect(getRoundTierTitle(2, 3)).toBe("Finals");
  });

  it("renders bracket rounds and matchup cards", () => {
    const matches: TreeMatch[] = [
      {
        id: "m1",
        roundIndex: 0,
        matchIndex: 0,
        gameCode: "game-101",
        status: "active",
        player1: { id: "p1", name: "Magnus", seed: 1, score: 0 },
        player2: { id: "p2", name: "Hikaru", seed: 2, score: 0 },
      },
      {
        id: "m2",
        roundIndex: 1,
        matchIndex: 0,
        gameCode: "game-102",
        status: "finished",
        winnerId: "p1",
        player1: { id: "p1", name: "Magnus", seed: 1, score: 1 },
        player2: { id: "p3", name: "Ding", seed: 3, score: 0 },
      },
    ];

    render(<TournamentBracketTree matches={matches} />);

    expect(screen.getByTestId("tournament-bracket-tree")).toBeInTheDocument();
    expect(screen.getAllByText("Magnus").length).toBeGreaterThan(0);
    expect(screen.getByText("Hikaru")).toBeInTheDocument();
    expect(screen.getByText("Ding")).toBeInTheDocument();

    // Active match pulse indicator
    expect(screen.getByText("LIVE")).toBeInTheDocument();
  });

  it("renders zoom controls", () => {
    const matches: TreeMatch[] = [
      {
        id: "m1",
        roundIndex: 0,
        matchIndex: 0,
        gameCode: "game-101",
        status: "active",
        player1: { id: "p1", name: "Player 1", seed: 1, score: 0 },
        player2: { id: "p2", name: "Player 2", seed: 2, score: 0 },
      },
    ];

    render(<TournamentBracketTree matches={matches} />);

    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "−" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset" })).toBeInTheDocument();
  });

  it("responds to zoom in button click", () => {
    const matches: TreeMatch[] = [
      {
        id: "m1",
        roundIndex: 0,
        matchIndex: 0,
        gameCode: "game-101",
        status: "active",
        player1: { id: "p1", name: "Player 1", seed: 1, score: 0 },
        player2: { id: "p2", name: "Player 2", seed: 2, score: 0 },
      },
    ];

    render(<TournamentBracketTree matches={matches} />);

    const zoomInBtn = screen.getByRole("button", { name: "+" });
    fireEvent.click(zoomInBtn);

    expect(screen.getByText("132%")).toBeInTheDocument();
  });

  it("responds to zoom out button click", () => {
    const matches: TreeMatch[] = [
      {
        id: "m1",
        roundIndex: 0,
        matchIndex: 0,
        gameCode: "game-101",
        status: "active",
        player1: { id: "p1", name: "Player 1", seed: 1, score: 0 },
        player2: { id: "p2", name: "Player 2", seed: 2, score: 0 },
      },
    ];

    render(<TournamentBracketTree matches={matches} />);

    const zoomOutBtn = screen.getByRole("button", { name: "−" });
    fireEvent.click(zoomOutBtn);

    expect(screen.getByText("83%")).toBeInTheDocument();
  });

  it("responds to reset view button", () => {
    const matches: TreeMatch[] = [
      {
        id: "m1",
        roundIndex: 0,
        matchIndex: 0,
        gameCode: "game-101",
        status: "active",
        player1: { id: "p1", name: "Player 1", seed: 1, score: 0 },
        player2: { id: "p2", name: "Player 2", seed: 2, score: 0 },
      },
    ];

    render(<TournamentBracketTree matches={matches} />);

    const zoomInBtn = screen.getByRole("button", { name: "+" });
    const resetBtn = screen.getByRole("button", { name: "Reset" });

    fireEvent.click(zoomInBtn);
    expect(screen.queryByText("100%")).not.toBeInTheDocument();

    fireEvent.click(resetBtn);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("responds to wheel zoom event", () => {
    const matches: TreeMatch[] = [
      {
        id: "m1",
        roundIndex: 0,
        matchIndex: 0,
        gameCode: "game-101",
        status: "active",
        player1: { id: "p1", name: "Player 1", seed: 1, score: 0 },
        player2: { id: "p2", name: "Player 2", seed: 2, score: 0 },
      },
    ];

    render(<TournamentBracketTree matches={matches} />);
    const container = screen.getByTestId("tournament-bracket-tree");

    fireEvent.wheel(container, { deltaY: -100 });
    expect(screen.getByText("132%")).toBeInTheDocument();

    fireEvent.wheel(container, { deltaY: 100 });
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("enforces zoom bounds", () => {
    const matches: TreeMatch[] = [
      {
        id: "m1",
        roundIndex: 0,
        matchIndex: 0,
        gameCode: "game-101",
        status: "active",
        player1: { id: "p1", name: "Player 1", seed: 1, score: 0 },
        player2: { id: "p2", name: "Player 2", seed: 2, score: 0 },
      },
    ];

    render(<TournamentBracketTree matches={matches} />);

    const zoomInBtn = screen.getByRole("button", { name: "+" });
    for (let i = 0; i < 20; i++) {
      fireEvent.click(zoomInBtn);
    }

    expect(screen.getByText("200%")).toBeInTheDocument();
  });

  it("clamps zoom out at 50%", () => {
    const matches: TreeMatch[] = [
      {
        id: "m1",
        roundIndex: 0,
        matchIndex: 0,
        gameCode: "game-101",
        status: "active",
        player1: { id: "p1", name: "Player 1" },
        player2: { id: "p2", name: "Player 2" },
      },
    ];

    render(<TournamentBracketTree matches={matches} />);
    const zoomOutBtn = screen.getByRole("button", { name: "−" });
    for (let i = 0; i < 20; i++) {
      fireEvent.click(zoomOutBtn);
    }

    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  it("zooms around the pointer position on wheel input", () => {
    const matches: TreeMatch[] = [
      {
        id: "m1",
        roundIndex: 0,
        matchIndex: 0,
        gameCode: "game-101",
        status: "active",
        player1: { id: "p1", name: "Player 1" },
        player2: { id: "p2", name: "Player 2" },
      },
    ];

    render(<TournamentBracketTree matches={matches} />);
    const container = screen.getByTestId("tournament-bracket-tree");
    container.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

    fireEvent.wheel(container, { deltaY: -100, clientX: 200, clientY: 100 });

    const content = screen.getByTestId("bracket-content");
    expect(content.style.transform).toContain("translate(-64px, -32px)");
    expect(content.style.transform).toContain("scale(1.32)");
  });

  it("pans the bracket by dragging the canvas", () => {
    const matches: TreeMatch[] = [
      {
        id: "m1",
        roundIndex: 0,
        matchIndex: 0,
        gameCode: "game-101",
        status: "active",
        player1: { id: "p1", name: "Player 1" },
        player2: { id: "p2", name: "Player 2" },
      },
    ];

    render(<TournamentBracketTree matches={matches} />);
    const container = screen.getByTestId("tournament-bracket-tree");

    fireEvent.mouseDown(container, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(container, { clientX: 150, clientY: 130 });
    fireEvent.mouseUp(container);

    expect(screen.getByTestId("bracket-content").style.transform).toContain(
      "translate(50px, 30px)",
    );
  });

  it("pinch-zooms on touch devices", () => {
    const matches: TreeMatch[] = [
      {
        id: "m1",
        roundIndex: 0,
        matchIndex: 0,
        gameCode: "game-101",
        status: "active",
        player1: { id: "p1", name: "Player 1" },
        player2: { id: "p2", name: "Player 2" },
      },
    ];

    render(<TournamentBracketTree matches={matches} />);
    const container = screen.getByTestId("tournament-bracket-tree");

    fireEvent.touchStart(container, {
      touches: [
        { clientX: 100, clientY: 100 },
        { clientX: 200, clientY: 100 },
      ],
    });
    fireEvent.touchMove(container, {
      touches: [
        { clientX: 50, clientY: 100 },
        { clientX: 250, clientY: 100 },
      ],
    });

    expect(screen.getByText("200%")).toBeInTheDocument();
  });

  it("highlights winning player when match is finished", () => {
    const matches: TreeMatch[] = [
      {
        id: "m1",
        roundIndex: 0,
        matchIndex: 0,
        gameCode: "game-101",
        status: "finished",
        winnerId: "p1",
        player1: { id: "p1", name: "Alice", seed: 1, score: 1 },
        player2: { id: "p2", name: "Bob", seed: 2, score: 0 },
      },
    ];

    render(<TournamentBracketTree matches={matches} />);
    const aliceText = screen.getByText("Alice");
    expect(aliceText.closest(".flex.items-center.justify-between")).toHaveClass("text-green-400");
  });

  it("navigates to live spectator view /game/:code when clicking matchup card", () => {
    const matches: TreeMatch[] = [
      {
        id: "m1",
        roundIndex: 0,
        matchIndex: 0,
        gameCode: "chess-live-123",
        status: "active",
        player1: { id: "p1", name: "Alice", seed: 1 },
        player2: { id: "p2", name: "Bob", seed: 2 },
      },
    ];

    render(<TournamentBracketTree matches={matches} />);
    const matchCard = screen.getByTestId("matchup-card-m1");
    fireEvent.click(matchCard);

    expect(mockNavigate).toHaveBeenCalledWith("/game/chess-live-123");
  });

  it("calls onMatchClick callback if provided when clicking matchup card", () => {
    const onMatchClick = vi.fn();
    const matches: TreeMatch[] = [
      {
        id: "m1",
        roundIndex: 0,
        matchIndex: 0,
        gameCode: "custom-match-999",
        status: "active",
        player1: { id: "p1", name: "Alice" },
        player2: { id: "p2", name: "Bob" },
      },
    ];

    render(<TournamentBracketTree matches={matches} onMatchClick={onMatchClick} />);
    const matchCard = screen.getByTestId("matchup-card-m1");
    fireEvent.click(matchCard);

    expect(onMatchClick).toHaveBeenCalledWith("custom-match-999");
  });
});
