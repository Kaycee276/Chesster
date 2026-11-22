import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ChessBoard from "../ChessBoard";
import { useGameStore } from "../../store/gameStore";

const START_BOARD = [
  ["r", "n", "b", "q", "k", "b", "n", "r"],
  ["p", "p", "p", "p", "p", "p", "p", "p"],
  ...Array.from({ length: 4 }, () => Array<string>(8).fill(".")),
  ["P", "P", "P", "P", "P", "P", "P", "P"],
  ["R", "N", "B", "Q", "K", "B", "N", "R"],
];
const initialState = useGameStore.getState();
const square = (row: number, col: number) => screen.getByTestId(`square-${row}-${col}`);
const renderBoard = () => render(<MemoryRouter><ChessBoard /></MemoryRouter>);
const focus = (element: HTMLElement) => act(() => { element.focus(); });

describe("keyboard and screen reader board play", () => {
  beforeEach(() => {
    useGameStore.setState({
      ...initialState, gameCode: "A11Y01", board: START_BOARD.map(row => [...row]),
      playerColor: "white", currentTurn: "white", status: "active",
      selectedSquare: null, queuedPremove: null, viewingIndex: null,
      moveHistory: [], lastMove: null, inCheck: false, winner: null,
      blindfoldMode: "none", isBlindfoldMode: false, isMoveConfirmationEnabled: false,
      fetchGameState: vi.fn().mockResolvedValue(undefined),
      loadMoveHistory: vi.fn().mockResolvedValue(undefined),
      makeMove: vi.fn().mockResolvedValue(undefined),
    });
  });
  afterEach(() => {
    cleanup();
    useGameStore.setState(initialState, true);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("exposes eight rows and one tab stop across all 64 cells", () => {
    renderBoard();
    const grid = screen.getByRole("grid", { name: "Chessboard" });
    const rows = within(grid).getAllByRole("row");
    expect(rows).toHaveLength(8);
    rows.forEach(row => expect(within(row).getAllByRole("gridcell")).toHaveLength(8));
    expect(within(grid).getAllByRole("gridcell").filter(cell => cell.tabIndex === 0)).toHaveLength(1);
    expect(grid).toHaveAttribute("aria-roledescription", "interactive chessboard");
  });

  it("moves actual focus, selects with Space, and activates a legal destination with Enter", async () => {
    renderBoard();
    focus(square(6, 4));
    fireEvent.keyDown(square(6, 4), { key: " " });
    expect(square(6, 4)).toHaveAttribute("aria-selected", "true");
    expect(square(4, 4)).toHaveAccessibleName("e4, empty, legal destination");
    fireEvent.keyDown(square(6, 4), { key: "ArrowUp" });
    expect(square(5, 4)).toHaveFocus();
    fireEvent.keyDown(square(5, 4), { key: "ArrowUp" });
    expect(square(4, 4)).toHaveFocus();
    await act(async () => { fireEvent.keyDown(square(4, 4), { key: "Enter" }); });
    expect(useGameStore.getState().makeMove).toHaveBeenCalledWith([6, 4], [4, 4], undefined);
    expect(square(4, 4)).toHaveFocus();
  });

  it("clamps board edges and cancels selected moves without leaving the grid", () => {
    renderBoard();
    focus(square(0, 0));
    fireEvent.keyDown(square(0, 0), { key: "ArrowLeft" });
    expect(square(0, 0)).toHaveFocus();
    focus(square(6, 4));
    fireEvent.keyDown(square(6, 4), { key: "Enter" });
    fireEvent.keyDown(square(6, 4), { key: "Escape" });
    expect(useGameStore.getState().selectedSquare).toBeNull();
    expect(square(6, 4)).toHaveFocus();
  });

  it("keeps an illegal keyboard destination from submitting a move", async () => {
    renderBoard();
    focus(square(6, 4));
    fireEvent.keyDown(square(6, 4), { key: "Enter" });
    focus(square(3, 4));
    await act(async () => { fireEvent.keyDown(square(3, 4), { key: "Enter" }); });
    expect(useGameStore.getState().makeMove).not.toHaveBeenCalled();
    expect(useGameStore.getState().selectedSquare).toEqual([6, 4]);
  });

  it("follows displayed directions for Black and a flipped board", () => {
    useGameStore.setState({ playerColor: "black", currentTurn: "black" });
    renderBoard();
    focus(square(1, 3));
    fireEvent.keyDown(square(1, 3), { key: "ArrowUp" });
    expect(square(2, 3)).toHaveFocus();
    fireEvent.keyDown(square(2, 3), { key: "f" });
    focus(square(1, 3));
    fireEvent.keyDown(square(1, 3), { key: "ArrowUp" });
    expect(square(0, 3)).toHaveFocus();
  });

  it("does not hijack Space on buttons outside the board", () => {
    renderBoard();
    const button = screen.getByTitle("Copy game code");
    focus(button);
    fireEvent.keyDown(button, { key: " " });
    expect(button).toHaveFocus();
  });

  it("completes keyboard promotion and restores board focus", async () => {
    const board = Array.from({ length: 8 }, (_, row) => Array.from({ length: 8 }, (_, col) =>
      row === 0 && col === 4 ? "k" : row === 7 && col === 4 ? "K" : row === 1 && col === 0 ? "P" : "."));
    useGameStore.setState({ board, autoQueen: false });
    renderBoard();
    focus(square(1, 0));
    fireEvent.keyDown(square(1, 0), { key: "Enter" });
    fireEvent.keyDown(square(1, 0), { key: "ArrowUp" });
    fireEvent.keyDown(square(0, 0), { key: "Enter" });
    expect(screen.getByRole("button", { name: "white queen" })).toHaveFocus();
    await act(async () => { fireEvent.keyDown(screen.getByRole("dialog"), { key: "n" }); });
    expect(useGameStore.getState().makeMove).toHaveBeenCalledWith([1, 0], [0, 0], "n");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(square(0, 0)).toHaveFocus();
  });

  it("announces a received capture/check once across polling and clock ticks", async () => {
    vi.useFakeTimers();
    const before = START_BOARD.map((row, rowIndex) => row.map((piece, colIndex) =>
      rowIndex === 5 && colIndex === 5 ? "n" : rowIndex === 6 && colIndex === 4 ? "P" : piece));
    useGameStore.setState({ board: before, currentTurn: "black" });
    renderBoard();
    const after = before.map((row, rowIndex) => row.map((piece, colIndex) =>
      rowIndex === 5 && colIndex === 5 ? "." : rowIndex === 6 && colIndex === 4 ? "n" : piece));
    act(() => useGameStore.setState({
      board: after, lastMove: { piece: "n", from: [5, 5], to: [6, 4] }, currentTurn: "white", inCheck: true,
    }));
    await act(async () => { vi.runOnlyPendingTimers(); });
    const region = screen.getByTestId("board-move-announcement");
    expect(region).toHaveTextContent("black knight from f3 to e2 captures white pawn. Check.");
    const message = region.textContent;
    act(() => useGameStore.setState({
      lastMove: { piece: "n", from: [5, 5], to: [6, 4] }, secondsLeft: 599,
    }));
    await act(async () => { vi.runOnlyPendingTimers(); });
    expect(region.textContent).toBe(message);
    vi.useRealTimers();
  });
});
