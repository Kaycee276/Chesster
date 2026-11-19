import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ChessBoard from "../ChessBoard";
import { useGameStore } from "../../store/gameStore";
import { isLegalDragTarget, isSameSquare, GHOST_SCALE } from "../../utils/dragSnap";

const START_BOARD = [
	["r", "n", "b", "q", "k", "b", "n", "r"],
	["p", "p", "p", "p", "p", "p", "p", "p"],
	[".", ".", ".", ".", ".", ".", ".", "."],
	[".", ".", ".", ".", ".", ".", ".", "."],
	[".", ".", ".", ".", ".", ".", ".", "."],
	[".", ".", ".", ".", ".", ".", ".", "."],
	["P", "P", "P", "P", "P", "P", "P", "P"],
	["R", "N", "B", "Q", "K", "B", "N", "R"],
];

const BOARD_PX = 400;
const SQUARE = BOARD_PX / 8;

/** Client coordinates of the centre of a square, for a white-oriented board at the origin. */
const centre = (row: number, col: number) => ({
	clientX: col * SQUARE + SQUARE / 2,
	clientY: row * SQUARE + SQUARE / 2,
});

const square = (row: number, col: number) => screen.getByTestId(`square-${row}-${col}`);

function renderBoard() {
	return render(
		<MemoryRouter>
			<ChessBoard />
		</MemoryRouter>,
	);
}

function pointer(el: Element, type: "pointerDown" | "pointerMove" | "pointerUp", row: number, col: number) {
	fireEvent[type](el, { pointerId: 1, pointerType: "mouse", button: 0, ...centre(row, col) });
}

describe("ChessBoard drag preview (#584)", () => {
	beforeEach(() => {
		vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
			() =>
				({ left: 0, top: 0, right: BOARD_PX, bottom: BOARD_PX, width: BOARD_PX, height: BOARD_PX, x: 0, y: 0 }) as DOMRect,
		);
		useGameStore.setState({
			gameCode: "TEST01",
			board: START_BOARD.map((r) => [...r]),
			playerColor: "white",
			currentTurn: "white",
			status: "active",
			selectedSquare: null,
			queuedPremove: null,
			viewingIndex: null,
			moveHistory: [],
			fetchGameState: vi.fn().mockResolvedValue(undefined),
			loadMoveHistory: vi.fn().mockResolvedValue(undefined),
		} as never);
	});

	/** Pick up the e2 pawn and drag it onto (row, col). */
	function dragPawnTo(row: number, col: number) {
		const source = square(6, 4);
		const grid = screen.getByRole("grid");
		pointer(source, "pointerDown", 6, 4);
		pointer(grid, "pointerMove", 5, 4);
		pointer(grid, "pointerMove", row, col);
		return grid;
	}

	it("shows an elevated, scaled ghost piece once the drag starts", () => {
		renderBoard();
		expect(screen.queryByTestId("ghost-piece-overlay")).toBeNull();

		dragPawnTo(4, 4);
		const ghost = screen.getByTestId("ghost-piece-overlay");
		expect(ghost.style.transform).toContain(`scale(${GHOST_SCALE})`);
		expect(ghost.style.filter).toContain("drop-shadow");
		expect(ghost.className).toContain("pointer-events-none");
		expect(ghost.className).toContain("cursor-grabbing");
		expect(screen.getByRole("grid").className).toContain("cursor-grabbing");
	});

	it("keeps the page from scrolling on touch by disabling native touch actions", () => {
		renderBoard();
		expect(screen.getByRole("grid").style.touchAction).toBe("none");
	});

	it("glows the hovered square when it is a legal destination", () => {
		renderBoard();
		dragPawnTo(4, 4); // e4: a legal double step
		const target = square(4, 4);
		expect(target.getAttribute("data-drag-hover")).toBe("legal");
		expect(target.className).toContain("ring-emerald-400/60");
		expect(target.className).toContain("bg-emerald-500/10");
	});

	it("moves the glow as the hovered square changes", () => {
		renderBoard();
		const grid = dragPawnTo(5, 4);
		expect(square(5, 4).getAttribute("data-drag-hover")).toBe("legal");

		pointer(grid, "pointerMove", 4, 4);
		expect(square(5, 4).getAttribute("data-drag-hover")).toBeNull();
		expect(square(4, 4).getAttribute("data-drag-hover")).toBe("legal");
	});

	it("shows no highlight when hovering an illegal square", () => {
		renderBoard();
		dragPawnTo(3, 4); // e5: three squares ahead, illegal
		expect(document.querySelectorAll("[data-drag-hover]")).toHaveLength(0);
		expect(square(3, 4).className).not.toContain("ring-emerald-400/60");
	});

	it("shows no highlight when hovering the origin square", () => {
		renderBoard();
		dragPawnTo(6, 4);
		expect(document.querySelectorAll("[data-drag-hover]")).toHaveLength(0);
	});

	it("clears the glow and ghost when the piece is dropped", async () => {
		const makeMove = vi.fn().mockResolvedValue(undefined);
		useGameStore.setState({ makeMove } as never);
		renderBoard();
		const grid = dragPawnTo(4, 4);

		await act(async () => {
			pointer(grid, "pointerUp", 4, 4);
		});

		expect(screen.queryByTestId("ghost-piece-overlay")).toBeNull();
		expect(document.querySelectorAll("[data-drag-hover]")).toHaveLength(0);
		expect(makeMove).toHaveBeenCalledWith([6, 4], [4, 4], undefined);
	});

	it("does not call the move callback when dropping on an illegal square", async () => {
		const makeMove = vi.fn().mockResolvedValue(undefined);
		useGameStore.setState({ makeMove } as never);
		renderBoard();
		const grid = dragPawnTo(3, 4);

		await act(async () => {
			pointer(grid, "pointerUp", 3, 4);
		});

		expect(makeMove).not.toHaveBeenCalled();
		expect(screen.queryByTestId("ghost-piece-overlay")).toBeNull();
	});

	it("clears the preview when the drag is cancelled", () => {
		renderBoard();
		const grid = dragPawnTo(4, 4);
		fireEvent.pointerCancel(grid, { pointerId: 1 });
		expect(screen.queryByTestId("ghost-piece-overlay")).toBeNull();
		expect(document.querySelectorAll("[data-drag-hover]")).toHaveLength(0);
	});
});

describe("dragSnap helpers (#584)", () => {
	it("compares squares including nulls", () => {
		expect(isSameSquare([1, 2], [1, 2])).toBe(true);
		expect(isSameSquare([1, 2], [2, 1])).toBe(false);
		expect(isSameSquare(null, null)).toBe(true);
		expect(isSameSquare(null, [0, 0])).toBe(false);
	});

	it("treats only listed non-origin squares as legal targets", () => {
		const legal: [number, number][] = [[5, 4], [4, 4]];
		expect(isLegalDragTarget([6, 4], [4, 4], legal)).toBe(true);
		expect(isLegalDragTarget([6, 4], [3, 4], legal)).toBe(false);
		expect(isLegalDragTarget([4, 4], [4, 4], legal)).toBe(false);
	});
});
