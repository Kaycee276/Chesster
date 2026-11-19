import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MoveList, FIGURINES, toFigurineNotation, formatMove } from "./MoveList";
import type { ReplayedMove } from "../utils/pgnParser";
import { useGameStore } from "../store/gameStore";

afterEach(cleanup);

function createMockMove(moveNumber: number, color: "white" | "black", san: string): ReplayedMove {
  return {
    moveNumber,
    color,
    san,
    from: [6, 4],
    to: [4, 4],
    piece: "P",
    isCapture: false,
    isCheck: false,
    isCheckmate: false,
    boardAfter: [],
  };
}

describe("Figurine Notation Helper Functions", () => {
  describe("FIGURINES mapping", () => {
    it("maps white pieces to white Unicode chess glyphs", () => {
      expect(FIGURINES.w.K).toBe("♔");
      expect(FIGURINES.w.Q).toBe("♕");
      expect(FIGURINES.w.R).toBe("♖");
      expect(FIGURINES.w.B).toBe("♗");
      expect(FIGURINES.w.N).toBe("♘");
    });

    it("maps black pieces to black Unicode chess glyphs", () => {
      expect(FIGURINES.b.K).toBe("♚");
      expect(FIGURINES.b.Q).toBe("♛");
      expect(FIGURINES.b.R).toBe("♜");
      expect(FIGURINES.b.B).toBe("♝");
      expect(FIGURINES.b.N).toBe("♞");
    });
  });

  describe("toFigurineNotation", () => {
    it("transforms white piece letters to white Unicode figurines", () => {
      expect(toFigurineNotation("Nf3", "w")).toBe("♘f3");
      expect(toFigurineNotation("Bxc6", "w")).toBe("♗xc6");
      expect(toFigurineNotation("Qxd4+", "w")).toBe("♕xd4+");
      expect(toFigurineNotation("Rad1", "w")).toBe("♖ad1");
      expect(toFigurineNotation("Kh1", "w")).toBe("♔h1");
      expect(toFigurineNotation("Qh5#", "w")).toBe("♕h5#");
    });

    it("transforms black piece letters to black Unicode figurines", () => {
      expect(toFigurineNotation("Nf6", "b")).toBe("♞f6");
      expect(toFigurineNotation("Bg4", "b")).toBe("♝g4");
      expect(toFigurineNotation("Qxd4+", "b")).toBe("♛xd4+");
      expect(toFigurineNotation("Rxf8#", "b")).toBe("♜xf8#");
      expect(toFigurineNotation("Ke7", "b")).toBe("♚e7");
    });

    it("leaves pawn moves unchanged", () => {
      expect(toFigurineNotation("e4", "w")).toBe("e4");
      expect(toFigurineNotation("d5", "b")).toBe("d5");
      expect(toFigurineNotation("exd5", "w")).toBe("exd5");
      expect(toFigurineNotation("c5", "b")).toBe("c5");
      expect(toFigurineNotation("a6", "b")).toBe("a6");
    });

    it("leaves castling notation unchanged without corruption", () => {
      expect(toFigurineNotation("O-O", "w")).toBe("O-O");
      expect(toFigurineNotation("O-O", "b")).toBe("O-O");
      expect(toFigurineNotation("O-O-O", "w")).toBe("O-O-O");
      expect(toFigurineNotation("O-O-O", "b")).toBe("O-O-O");
    });

    it("handles empty or falsy strings gracefully", () => {
      expect(toFigurineNotation("", "w")).toBe("");
    });
  });

  describe("formatMove", () => {
    it("returns original SAN when useFigurine is false", () => {
      expect(formatMove("Nf3", "w", false)).toBe("Nf3");
      expect(formatMove("Nf6", "b", false)).toBe("Nf6");
      expect(formatMove("Qxd4+", "w", false)).toBe("Qxd4+");
      expect(formatMove("e4", "w", false)).toBe("e4");
      expect(formatMove("O-O", "w", false)).toBe("O-O");
    });

    it("returns figurine notation when useFigurine is true", () => {
      expect(formatMove("Nf3", "w", true)).toBe("♘f3");
      expect(formatMove("Nf6", "b", true)).toBe("♞f6");
      expect(formatMove("Bxc6", "w", true)).toBe("♗xc6");
      expect(formatMove("e4", "w", true)).toBe("e4");
      expect(formatMove("O-O", "w", true)).toBe("O-O");
    });
  });
});

describe("MoveList Component", () => {
  const sampleMoves: ReplayedMove[] = [
    createMockMove(1, "white", "e4"),
    createMockMove(1, "black", "e5"),
    createMockMove(2, "white", "Nf3"),
    createMockMove(2, "black", "Nc6"),
    createMockMove(3, "white", "Bb5"),
    createMockMove(3, "black", "a6"),
    createMockMove(4, "white", "O-O"),
    createMockMove(4, "black", "Nf6"),
  ];

  beforeEach(() => {
    useGameStore.setState({ isFigurineNotation: false });
  });

  it("renders empty state message when there are no moves", () => {
    render(<MoveList moves={[]} currentIndex={-1} />);
    expect(screen.getByText("No moves played yet.")).toBeInTheDocument();
  });

  it("renders standard notation by default when store figurine is disabled", () => {
    render(<MoveList moves={sampleMoves} currentIndex={-1} />);
    expect(screen.getByText("Nf3")).toBeInTheDocument();
    expect(screen.getByText("Nc6")).toBeInTheDocument();
    expect(screen.getByText("Bb5")).toBeInTheDocument();
    expect(screen.getByText("O-O")).toBeInTheDocument();
    expect(screen.getByText("e4")).toBeInTheDocument();
    expect(screen.getByText("e5")).toBeInTheDocument();
  });

  it("renders figurine notation when useFigurine prop is true", () => {
    render(<MoveList moves={sampleMoves} currentIndex={-1} useFigurine={true} />);
    expect(screen.getByText("♘f3")).toBeInTheDocument();
    expect(screen.getByText("♞c6")).toBeInTheDocument();
    expect(screen.getByText("♗b5")).toBeInTheDocument();
    expect(screen.getByText("O-O")).toBeInTheDocument();
    expect(screen.getByText("e4")).toBeInTheDocument();
    expect(screen.getByText("e5")).toBeInTheDocument();
  });

  it("toggles figurine notation via the toggle button in MoveList", async () => {
    const user = userEvent.setup();
    render(<MoveList moves={sampleMoves} currentIndex={-1} />);

    // Initially standard notation
    expect(screen.getByText("Nf3")).toBeInTheDocument();

    const toggleBtn = screen.getByTestId("toggle-figurine-notation");
    await user.click(toggleBtn);

    // After clicking toggle, gameStore is updated and moves display figurines
    expect(screen.getByText("♘f3")).toBeInTheDocument();
    expect(screen.getByText("♞c6")).toBeInTheDocument();
    expect(screen.getByText("♗b5")).toBeInTheDocument();

    // Toggle back to standard
    await user.click(toggleBtn);
    expect(screen.getByText("Nf3")).toBeInTheDocument();
    expect(screen.getByText("Nc6")).toBeInTheDocument();
  });

  it("calls onSelectMove callback when move row item is clicked", () => {
    const onSelect = vi.fn();
    render(<MoveList moves={sampleMoves} currentIndex={0} onSelectMove={onSelect} />);

    const whiteMove = screen.getByText("Nf3");
    fireEvent.click(whiteMove);
    // index of Nf3 is 2
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it("renders quality badge if provided in classifications", () => {
    const classifications = [
      { quality: "best" as const, cpl: 0 },
      { quality: "blunder" as const, cpl: 350 },
    ];
    render(
      <MoveList
        moves={sampleMoves.slice(0, 2)}
        currentIndex={-1}
        classifications={classifications}
      />
    );
    expect(screen.getByTestId("badge-best")).toBeInTheDocument();
    expect(screen.getByTestId("badge-blunder")).toBeInTheDocument();
  });

  it("respects showToggle={false} prop to hide the header bar", () => {
    render(<MoveList moves={sampleMoves} currentIndex={-1} showToggle={false} />);
    expect(screen.queryByTestId("toggle-figurine-notation")).not.toBeInTheDocument();
  });
});
