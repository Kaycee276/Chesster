import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import MoveNavigator from "../MoveNavigator";

afterEach(cleanup);

function setup(overrides: Partial<Parameters<typeof MoveNavigator>[0]> = {}) {
  const onMoveChange = vi.fn();
  const onTogglePlay = vi.fn();
  const utils = render(
    <MoveNavigator
      currentMoveIndex={2}
      totalMoves={6}
      isPlaying={false}
      onMoveChange={onMoveChange}
      onTogglePlay={onTogglePlay}
      {...overrides}
    />
  );
  return { ...utils, onMoveChange, onTogglePlay };
}

describe("MoveNavigator Comprehensive Suite", () => {
  describe("rendering and state disabled matrix", () => {
    it("renders first move button with correct aria label", () => {
      setup();
      expect(screen.getByRole("button", { name: /first move/i })).toBeInTheDocument();
    });

    it("renders previous move button with correct aria label", () => {
      setup();
      expect(screen.getByRole("button", { name: /previous move/i })).toBeInTheDocument();
    });

    it("renders next move button with correct aria label", () => {
      setup();
      expect(screen.getByRole("button", { name: /next move/i })).toBeInTheDocument();
    });

    it("renders last move button with correct aria label", () => {
      setup();
      expect(screen.getByRole("button", { name: /last move/i })).toBeInTheDocument();
    });

    it("disables first and previous buttons when at initial state (-1)", () => {
      setup({ currentMoveIndex: -1 });
      expect(screen.getByRole("button", { name: /first move/i })).toBeDisabled();
      expect(screen.getByRole("button", { name: /previous move/i })).toBeDisabled();
      expect(screen.getByRole("button", { name: /next move/i })).not.toBeDisabled();
      expect(screen.getByRole("button", { name: /last move/i })).not.toBeDisabled();
    });

    it("disables next and last buttons when at the final move (totalMoves - 1)", () => {
      setup({ currentMoveIndex: 5, totalMoves: 6 });
      expect(screen.getByRole("button", { name: /next move/i })).toBeDisabled();
      expect(screen.getByRole("button", { name: /last move/i })).toBeDisabled();
      expect(screen.getByRole("button", { name: /previous move/i })).not.toBeDisabled();
      expect(screen.getByRole("button", { name: /first move/i })).not.toBeDisabled();
    });

    it("enables all buttons when positioned in intermediate moves", () => {
      setup({ currentMoveIndex: 3, totalMoves: 6 });
      expect(screen.getByRole("button", { name: /first move/i })).not.toBeDisabled();
      expect(screen.getByRole("button", { name: /previous move/i })).not.toBeDisabled();
      expect(screen.getByRole("button", { name: /next move/i })).not.toBeDisabled();
      expect(screen.getByRole("button", { name: /last move/i })).not.toBeDisabled();
    });

    it("disables all buttons when totalMoves is 0", () => {
      setup({ currentMoveIndex: -1, totalMoves: 0 });
      expect(screen.getByRole("button", { name: /first move/i })).toBeDisabled();
      expect(screen.getByRole("button", { name: /previous move/i })).toBeDisabled();
      expect(screen.getByRole("button", { name: /next move/i })).toBeDisabled();
      expect(screen.getByRole("button", { name: /last move/i })).toBeDisabled();
    });

    it("toggles play/pause state when play button is clicked", () => {
      const { onTogglePlay } = setup({ isPlaying: false });
      const playBtn = screen.getByRole("button", { name: /play|pause|auto/i });
      fireEvent.click(playBtn);
      expect(onTogglePlay).toHaveBeenCalledTimes(1);
    });
  });

  describe("step-by-step navigation matrix across indices", () => {
    // Test backward stepping across indices 0 to 9
    it.each([
      [0, -1],
      [1, 0],
      [2, 1],
      [3, 2],
      [4, 3],
      [5, 4],
      [6, 5],
      [7, 6],
      [8, 7],
      [9, 8],
    ])("ArrowLeft steps backward from index %i to %i", (fromIndex, expectedIndex) => {
      const { onMoveChange } = setup({ currentMoveIndex: fromIndex, totalMoves: 10 });
      fireEvent.keyDown(window, { key: "ArrowLeft" });
      expect(onMoveChange).toHaveBeenCalledWith(expectedIndex);
    });

    // Test forward stepping across indices -1 to 8
    it.each([
      [-1, 0],
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 8],
      [8, 9],
    ])("ArrowRight steps forward from index %i to %i", (fromIndex, expectedIndex) => {
      const { onMoveChange } = setup({ currentMoveIndex: fromIndex, totalMoves: 10 });
      fireEvent.keyDown(window, { key: "ArrowRight" });
      expect(onMoveChange).toHaveBeenCalledWith(expectedIndex);
    });

    // Test Home key jumping to -1 from every position
    it.each([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])(
      "Home jumps to start (-1) from index %i",
      (fromIndex) => {
        const { onMoveChange } = setup({ currentMoveIndex: fromIndex, totalMoves: 10 });
        fireEvent.keyDown(window, { key: "Home" });
        expect(onMoveChange).toHaveBeenCalledWith(-1);
      }
    );

    // Test ArrowUp jumping to -1 from every position
    it.each([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])(
      "ArrowUp jumps to start (-1) from index %i",
      (fromIndex) => {
        const { onMoveChange } = setup({ currentMoveIndex: fromIndex, totalMoves: 10 });
        fireEvent.keyDown(window, { key: "ArrowUp" });
        expect(onMoveChange).toHaveBeenCalledWith(-1);
      }
    );

    // Test End key jumping to final move (9) from every position
    it.each([-1, 0, 1, 2, 3, 4, 5, 6, 7, 8])(
      "End jumps to final move (9) from index %i",
      (fromIndex) => {
        const { onMoveChange } = setup({ currentMoveIndex: fromIndex, totalMoves: 10 });
        fireEvent.keyDown(window, { key: "End" });
        expect(onMoveChange).toHaveBeenCalledWith(9);
      }
    );

    // Test ArrowDown jumping to final move (9) from every position
    it.each([-1, 0, 1, 2, 3, 4, 5, 6, 7, 8])(
      "ArrowDown jumps to final move (9) from index %i",
      (fromIndex) => {
        const { onMoveChange } = setup({ currentMoveIndex: fromIndex, totalMoves: 10 });
        fireEvent.keyDown(window, { key: "ArrowDown" });
        expect(onMoveChange).toHaveBeenCalledWith(9);
      }
    );
  });

  describe("boundary conditions and no-ops", () => {
    it("does not navigate backward when already at start index (-1)", () => {
      const { onMoveChange } = setup({ currentMoveIndex: -1, totalMoves: 10 });
      fireEvent.keyDown(window, { key: "ArrowLeft" });
      expect(onMoveChange).not.toHaveBeenCalled();
    });

    it("does not navigate to start when already at start index (-1)", () => {
      const { onMoveChange } = setup({ currentMoveIndex: -1, totalMoves: 10 });
      fireEvent.keyDown(window, { key: "Home" });
      fireEvent.keyDown(window, { key: "ArrowUp" });
      expect(onMoveChange).not.toHaveBeenCalled();
    });

    it("does not navigate forward when already at final index", () => {
      const { onMoveChange } = setup({ currentMoveIndex: 9, totalMoves: 10 });
      fireEvent.keyDown(window, { key: "ArrowRight" });
      expect(onMoveChange).not.toHaveBeenCalled();
    });

    it("does not navigate to end when already at final index", () => {
      const { onMoveChange } = setup({ currentMoveIndex: 9, totalMoves: 10 });
      fireEvent.keyDown(window, { key: "End" });
      fireEvent.keyDown(window, { key: "ArrowDown" });
      expect(onMoveChange).not.toHaveBeenCalled();
    });

    it("does not trigger any movement when totalMoves is 0", () => {
      const { onMoveChange } = setup({ currentMoveIndex: -1, totalMoves: 0 });
      for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]) {
        fireEvent.keyDown(window, { key });
      }
      expect(onMoveChange).not.toHaveBeenCalled();
    });
  });

  describe("modifier key matrix (6 keys x 6 modifier combinations = 36 tests)", () => {
    const navKeys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
    const modifierCombinations = [
      { name: "ctrlKey", flags: { ctrlKey: true } },
      { name: "altKey", flags: { altKey: true } },
      { name: "metaKey", flags: { metaKey: true } },
      { name: "ctrlKey+altKey", flags: { ctrlKey: true, altKey: true } },
      { name: "ctrlKey+metaKey", flags: { ctrlKey: true, metaKey: true } },
      { name: "altKey+metaKey", flags: { altKey: true, metaKey: true } },
    ];

    for (const { name: modName, flags } of modifierCombinations) {
      for (const key of navKeys) {
        it(`suppresses ${key} when ${modName} is active`, () => {
          const { onMoveChange } = setup({ currentMoveIndex: 3, totalMoves: 10 });
          fireEvent.keyDown(window, { key, ...flags });
          expect(onMoveChange).not.toHaveBeenCalled();
        });
      }
    }
  });

  describe("input suppression matrix", () => {
    const inputTypes = ["text", "search", "password", "email", "number", "url", "tel"];

    for (const type of inputTypes) {
      it(`suppresses keyboard shortcuts inside input[type="${type}"]`, () => {
        const { onMoveChange } = setup({ currentMoveIndex: 3, totalMoves: 10 });
        const input = document.createElement("input");
        input.type = type;
        document.body.appendChild(input);
        input.focus();

        fireEvent.keyDown(input, { key: "ArrowLeft" });
        fireEvent.keyDown(input, { key: "ArrowRight" });
        expect(onMoveChange).not.toHaveBeenCalled();

        document.body.removeChild(input);
      });
    }

    it("suppresses shortcuts inside textarea", () => {
      const { onMoveChange } = setup({ currentMoveIndex: 3, totalMoves: 10 });
      const textarea = document.createElement("textarea");
      document.body.appendChild(textarea);
      textarea.focus();

      fireEvent.keyDown(textarea, { key: "ArrowLeft" });
      expect(onMoveChange).not.toHaveBeenCalled();

      document.body.removeChild(textarea);
    });

    it("suppresses shortcuts inside select elements", () => {
      const { onMoveChange } = setup({ currentMoveIndex: 3, totalMoves: 10 });
      const select = document.createElement("select");
      document.body.appendChild(select);
      select.focus();

      fireEvent.keyDown(select, { key: "ArrowDown" });
      expect(onMoveChange).not.toHaveBeenCalled();

      document.body.removeChild(select);
    });

    it("suppresses shortcuts inside div with contentEditable='true'", () => {
      const { onMoveChange } = setup({ currentMoveIndex: 3, totalMoves: 10 });
      const div = document.createElement("div");
      div.contentEditable = "true";
      document.body.appendChild(div);
      div.focus();

      fireEvent.keyDown(div, { key: "ArrowRight" });
      expect(onMoveChange).not.toHaveBeenCalled();

      document.body.removeChild(div);
    });

    it("suppresses shortcuts inside div with contenteditable attribute set", () => {
      const { onMoveChange } = setup({ currentMoveIndex: 3, totalMoves: 10 });
      const div = document.createElement("div");
      div.setAttribute("contenteditable", "plaintext-only");
      document.body.appendChild(div);
      div.focus();

      fireEvent.keyDown(div, { key: "ArrowLeft" });
      expect(onMoveChange).not.toHaveBeenCalled();

      document.body.removeChild(div);
    });

    it("suppresses shortcuts on nested span inside contenteditable container", () => {
      const { onMoveChange } = setup({ currentMoveIndex: 3, totalMoves: 10 });
      const container = document.createElement("div");
      container.contentEditable = "true";
      const childSpan = document.createElement("span");
      container.appendChild(childSpan);
      document.body.appendChild(container);

      fireEvent.keyDown(childSpan, { key: "ArrowRight" });
      expect(onMoveChange).not.toHaveBeenCalled();

      document.body.removeChild(container);
    });
  });

  describe("non-navigation key ignore matrix", () => {
    const nonNavKeys = [
      "a",
      "z",
      "1",
      "Enter",
      "Space",
      "Tab",
      "Escape",
      "Backspace",
      "Delete",
      "Shift",
      "PageUp",
      "PageDown",
      "F1",
      "F5",
    ];

    for (const key of nonNavKeys) {
      it(`ignores unrelated key '${key}' without triggering navigation`, () => {
        const { onMoveChange } = setup({ currentMoveIndex: 3, totalMoves: 10 });
        fireEvent.keyDown(window, { key });
        expect(onMoveChange).not.toHaveBeenCalled();
      });
    }
  });

  describe("stress and lifecycle integrity", () => {
    it("removes event listener cleanly on unmount", () => {
      const { unmount, onMoveChange } = setup({ currentMoveIndex: 3, totalMoves: 10 });
      unmount();

      fireEvent.keyDown(window, { key: "ArrowLeft" });
      fireEvent.keyDown(window, { key: "ArrowRight" });
      expect(onMoveChange).not.toHaveBeenCalled();
    });

    it("handles multiple mount and unmount cycles without memory leaks", () => {
      for (let i = 0; i < 5; i++) {
        const { unmount, onMoveChange } = setup({ currentMoveIndex: 3, totalMoves: 10 });
        fireEvent.keyDown(window, { key: "ArrowRight" });
        expect(onMoveChange).toHaveBeenCalledTimes(1);
        unmount();
      }
    });

    it("safely handles rapid alternating key presses", () => {
      const { onMoveChange } = setup({ currentMoveIndex: 3, totalMoves: 10 });
      fireEvent.keyDown(window, { key: "ArrowLeft" });
      fireEvent.keyDown(window, { key: "ArrowRight" });
      fireEvent.keyDown(window, { key: "Home" });
      fireEvent.keyDown(window, { key: "End" });

      expect(onMoveChange).toHaveBeenCalledTimes(4);
      expect(onMoveChange).toHaveBeenNthCalledWith(1, 2);
      expect(onMoveChange).toHaveBeenNthCalledWith(2, 4);
      expect(onMoveChange).toHaveBeenNthCalledWith(3, -1);
      expect(onMoveChange).toHaveBeenNthCalledWith(4, 9);
    });
  });
});
