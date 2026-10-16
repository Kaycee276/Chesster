import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SpectatorListModal from "../../src/components/SpectatorListModal";

describe("SpectatorListModal", () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    mockOnClose.mockClear();
  });

  it("does not render when not open", () => {
    render(
      <SpectatorListModal
        isOpen={false}
        onClose={mockOnClose}
        spectatorCount={0}
        spectatorList={[]}
      />
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders when open with proper ARIA attributes", () => {
    render(
      <SpectatorListModal
        isOpen={true}
        onClose={mockOnClose}
        spectatorCount={1}
        spectatorList={[]}
      />
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "spectator-modal-title");
  });

  it("displays title with 'Spectators'", () => {
    render(
      <SpectatorListModal
        isOpen={true}
        onClose={mockOnClose}
        spectatorCount={2}
        spectatorList={[]}
      />
    );
    expect(screen.getByText("Spectators")).toBeInTheDocument();
  });

  it("shows correct singular count message", () => {
    render(
      <SpectatorListModal
        isOpen={true}
        onClose={mockOnClose}
        spectatorCount={1}
        spectatorList={[]}
      />
    );
    expect(screen.getByText("1 spectator watching")).toBeInTheDocument();
  });

  it("shows correct plural count message", () => {
    render(
      <SpectatorListModal
        isOpen={true}
        onClose={mockOnClose}
        spectatorCount={5}
        spectatorList={[]}
      />
    );
    expect(screen.getByText("5 spectators watching")).toBeInTheDocument();
  });

  it("displays empty state when no spectators", () => {
    render(
      <SpectatorListModal
        isOpen={true}
        onClose={mockOnClose}
        spectatorCount={0}
        spectatorList={[]}
      />
    );
    expect(screen.getByText("No spectators right now")).toBeInTheDocument();
  });

  it("renders spectators with usernames when available", () => {
    const spectators = [
      { address: "GABC1234567890WXYZ", username: "Alice" },
      { address: "GDEF9876543210MNOP", username: "Bob" },
    ];
    render(
      <SpectatorListModal
        isOpen={true}
        onClose={mockOnClose}
        spectatorCount={2}
        spectatorList={spectators}
      />
    );
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("falls back to truncated address when username is not available", () => {
    const spectators = [
      { address: "GABC1234567890WXYZ", username: null },
    ];
    render(
      <SpectatorListModal
        isOpen={true}
        onClose={mockOnClose}
        spectatorCount={1}
        spectatorList={spectators}
      />
    );
    expect(screen.getByText("GABC...WXYZ")).toBeInTheDocument();
  });

  it("closes on close button click", async () => {
    const user = userEvent.setup();
    render(
      <SpectatorListModal
        isOpen={true}
        onClose={mockOnClose}
        spectatorCount={0}
        spectatorList={[]}
      />
    );
    const closeButton = screen.getByLabelText("Close spectators list");
    await user.click(closeButton);
    expect(mockOnClose).toHaveBeenCalled();
  });

  it("closes on Escape key", async () => {
    render(
      <SpectatorListModal
        isOpen={true}
        onClose={mockOnClose}
        spectatorCount={0}
        spectatorList={[]}
      />
    );
    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    expect(mockOnClose).toHaveBeenCalled();
  });

  it("closes on backdrop click", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <SpectatorListModal
        isOpen={true}
        onClose={mockOnClose}
        spectatorCount={0}
        spectatorList={[]}
      />
    );
    const backdrop = container.querySelector("[class*='fixed inset-0']");
    if (backdrop) {
      await user.click(backdrop);
    }
    expect(mockOnClose).toHaveBeenCalled();
  });

  it("does not close when dialog content is clicked", async () => {
    const user = userEvent.setup();
    render(
      <SpectatorListModal
        isOpen={true}
        onClose={mockOnClose}
        spectatorCount={0}
        spectatorList={[]}
      />
    );
    const dialog = screen.getByRole("dialog");
    await user.click(dialog);
    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it("updates spectator count reactively", () => {
    const { rerender } = render(
      <SpectatorListModal
        isOpen={true}
        onClose={mockOnClose}
        spectatorCount={2}
        spectatorList={[]}
      />
    );
    expect(screen.getByText("2 spectators watching")).toBeInTheDocument();

    rerender(
      <SpectatorListModal
        isOpen={true}
        onClose={mockOnClose}
        spectatorCount={3}
        spectatorList={[]}
      />
    );
    expect(screen.getByText("3 spectators watching")).toBeInTheDocument();
  });

  it("updates spectator list reactively", () => {
    const spectators1 = [{ address: "GABC1234567890WXYZ", username: "Alice" }];
    const spectators2 = [
      { address: "GABC1234567890WXYZ", username: "Alice" },
      { address: "GDEF9876543210MNOP", username: "Bob" },
    ];

    const { rerender } = render(
      <SpectatorListModal
        isOpen={true}
        onClose={mockOnClose}
        spectatorCount={1}
        spectatorList={spectators1}
      />
    );
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.queryByText("Bob")).not.toBeInTheDocument();

    rerender(
      <SpectatorListModal
        isOpen={true}
        onClose={mockOnClose}
        spectatorCount={2}
        spectatorList={spectators2}
      />
    );
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("is scrollable when list is long", () => {
    const spectators = Array.from({ length: 20 }, (_, i) => ({
      address: `GABC${String(i).padStart(48, '0')}`,
      username: `User${i}`,
    }));

    const { container } = render(
      <SpectatorListModal
        isOpen={true}
        onClose={mockOnClose}
        spectatorCount={20}
        spectatorList={spectators}
      />
    );

    const scrollArea = container.querySelector("[class*='overflow-y-auto']");
    expect(scrollArea).toBeInTheDocument();
  });

  it("has visual indicator (dot) before each spectator name", () => {
    const spectators = [{ address: "GABC1234567890WXYZ", username: "Alice" }];
    const { container } = render(
      <SpectatorListModal
        isOpen={true}
        onClose={mockOnClose}
        spectatorCount={1}
        spectatorList={spectators}
      />
    );
    const dots = container.querySelectorAll("[class*='rounded-full']");
    expect(dots.length).toBeGreaterThan(0);
  });
});
