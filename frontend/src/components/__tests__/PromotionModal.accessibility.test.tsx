import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import PromotionModal from "../PromotionModal";

afterEach(cleanup);

describe("accessible promotion choice", () => {
  it("names all choices, focuses the queen and traps Tab in the dialog", () => {
    render(<PromotionModal color="white" onSelect={vi.fn()} onCancel={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "Choose promotion piece" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const queen = screen.getByRole("button", { name: "white queen" });
    expect(queen).toHaveFocus();
    ["rook", "bishop", "knight"].forEach(name => expect(screen.getByRole("button", { name: `white ${name}` })).toBeVisible());
    fireEvent.keyDown(queen, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "Cancel promotion" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(queen).toHaveFocus();
  });

  it("supports letter shortcuts and Escape, and restores focus after dismissal", () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const onSelect = vi.fn();
    const onCancel = vi.fn();
    const { unmount } = render(<PromotionModal color="black" onSelect={onSelect} onCancel={onCancel} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "n" });
    expect(onSelect).toHaveBeenCalledWith("n");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
    act(unmount);
    expect(trigger).toHaveFocus();
    trigger.remove();
  });
});
