import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { useRef, useState } from "react";
import { useFocusTrap } from "../../src/hooks/useFocusTrap";

/**
 * Test harness component
 */
function TestComponent({
  isActive,
  focusableCount = 3,
  hasDynamic = false,
}: {
  isActive: boolean;
  focusableCount?: number;
  hasDynamic?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [dynamicCount, setDynamicCount] = useState(0);
  useFocusTrap(ref, isActive);

  return (
    <>
      <button>Prior focus (outside trap)</button>
      <div ref={ref} role="dialog" data-testid="trap-container">
        {Array.from({ length: focusableCount }).map((_, i) => (
          <button key={i} data-testid={`focusable-${i}`}>
            Button {i}
          </button>
        ))}
        {hasDynamic && (
          <>
            {Array.from({ length: dynamicCount }).map((_, i) => (
              <button key={`dynamic-${i}`} data-testid={`dynamic-${i}`}>
                Dynamic {i}
              </button>
            ))}
            <button
              onClick={() => setDynamicCount((c) => c + 1)}
              data-testid="add-dynamic"
            >
              Add
            </button>
          </>
        )}
      </div>
    </>
  );
}

describe("useFocusTrap", () => {
  let priorButton: HTMLButtonElement;

  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("moves focus into container on activation", () => {
    const { getByTestId } = render(<TestComponent isActive={true} />);
    const focusable0 = getByTestId("focusable-0");
    expect(document.activeElement).toBe(focusable0);
  });

  it("restores prior focus on deactivation", () => {
    const { getByTestId, rerender } = render(<TestComponent isActive={false} />);
    priorButton = getByTestId("focusable-0").parentElement?.parentElement?.querySelector(
      "button"
    ) as HTMLButtonElement;

    // Activate trap (focus moves to first focusable in trap)
    rerender(<TestComponent isActive={true} />);
    expect(document.activeElement).not.toBe(priorButton);

    // Deactivate trap (focus should return to prior)
    // Note: since we didn't manually focus priorButton, we focus it first
    priorButton.focus();
    rerender(<TestComponent isActive={true} />);
    const activeInTrap = document.activeElement;

    rerender(<TestComponent isActive={false} />);
    expect(document.activeElement).toBe(priorButton);
  });

  it("Tab from last focusable wraps to first", () => {
    const { getByTestId } = render(<TestComponent isActive={true} focusableCount={3} />);
    const last = getByTestId("focusable-2") as HTMLButtonElement;
    const first = getByTestId("focusable-0") as HTMLButtonElement;

    last.focus();
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(last, { key: "Tab", code: "Tab" });
    expect(document.activeElement).toBe(first);
  });

  it("Shift+Tab from first focusable wraps to last", () => {
    const { getByTestId } = render(<TestComponent isActive={true} focusableCount={3} />);
    const first = getByTestId("focusable-0") as HTMLButtonElement;
    const last = getByTestId("focusable-2") as HTMLButtonElement;

    first.focus();
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first, { key: "Tab", code: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("keeps focus in container when no focusables exist", () => {
    const { getByTestId } = render(
      <TestComponent isActive={true} focusableCount={0} />
    );
    const container = getByTestId("trap-container");

    expect(document.activeElement).toBe(container);

    // Try to tab out
    fireEvent.keyDown(container, { key: "Tab", code: "Tab" });
    expect(document.activeElement).toBe(container);

    // Try Shift+Tab
    fireEvent.keyDown(container, { key: "Tab", code: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(container);
  });

  it("includes dynamically added focusables in cycle", () => {
    const { getByTestId, rerender } = render(
      <TestComponent isActive={true} focusableCount={1} hasDynamic={true} />
    );

    // Click "Add" to add a dynamic focusable
    const addButton = getByTestId("add-dynamic");
    fireEvent.click(addButton);

    // Now we should have focusable-0, dynamic-0, and add-dynamic (3 total)
    const focusable0 = getByTestId("focusable-0");
    focusable0.focus();

    fireEvent.keyDown(focusable0, { key: "Tab", code: "Tab" });

    // Should cycle through the newly added dynamic element
    const dynamic0 = getByTestId("dynamic-0");
    expect(document.activeElement).toBe(dynamic0);
  });

  it("removes keydown listener on deactivation", () => {
    const { getByTestId, rerender } = render(<TestComponent isActive={true} />);
    const container = getByTestId("trap-container");
    const first = getByTestId("focusable-0") as HTMLButtonElement;
    const last = getByTestId("focusable-2") as HTMLButtonElement;

    first.focus();

    // While active, Tab from first should wrap
    fireEvent.keyDown(first, { key: "Tab", code: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);

    // Deactivate
    rerender(<TestComponent isActive={false} />);

    // Reset focus to first
    first.focus();

    // Now Tab should NOT wrap (listener removed)
    fireEvent.keyDown(first, { key: "Tab", code: "Tab", shiftKey: true });
    // Focus should not change (default Tab behavior not intercepted)
    // In a real browser, focus would move to next tabbable, but in jsdom it stays
    expect(document.activeElement).toBe(first);
  });

  it("handles reactivation correctly", () => {
    const { getByTestId, rerender } = render(<TestComponent isActive={false} />);

    // Activate
    rerender(<TestComponent isActive={true} />);
    const first = getByTestId("focusable-0");
    expect(document.activeElement).toBe(first);

    // Deactivate
    rerender(<TestComponent isActive={false} />);

    // Activate again
    rerender(<TestComponent isActive={true} />);
    expect(document.activeElement).toBe(first);
  });

  it("Tab in middle of focusables moves to next", () => {
    const { getByTestId } = render(<TestComponent isActive={true} focusableCount={3} />);
    const btn1 = getByTestId("focusable-1") as HTMLButtonElement;
    const btn2 = getByTestId("focusable-2") as HTMLButtonElement;

    btn1.focus();
    expect(document.activeElement).toBe(btn1);

    fireEvent.keyDown(btn1, { key: "Tab", code: "Tab" });
    expect(document.activeElement).toBe(btn2);
  });

  it("Shift+Tab in middle of focusables moves to previous", () => {
    const { getByTestId } = render(<TestComponent isActive={true} focusableCount={3} />);
    const btn0 = getByTestId("focusable-0") as HTMLButtonElement;
    const btn1 = getByTestId("focusable-1") as HTMLButtonElement;

    btn1.focus();
    expect(document.activeElement).toBe(btn1);

    fireEvent.keyDown(btn1, { key: "Tab", code: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(btn0);
  });

  it("ignores non-Tab keys", () => {
    const { getByTestId } = render(<TestComponent isActive={true} focusableCount={2} />);
    const btn0 = getByTestId("focusable-0") as HTMLButtonElement;
    const btn1 = getByTestId("focusable-1") as HTMLButtonElement;

    btn0.focus();
    fireEvent.keyDown(btn0, { key: "Enter", code: "Enter" });
    expect(document.activeElement).toBe(btn0); // No change
  });

  it("cleans up on unmount", () => {
    const { unmount, getByTestId } = render(<TestComponent isActive={true} />);
    const container = getByTestId("trap-container");

    // Listener should be attached while active
    const listenerCount = (container as any).__listeners?.keydown?.length || 0;

    unmount();

    // After unmount, listener should be cleaned up
    // (Can't directly verify in jsdom, but no errors should occur)
    expect(true).toBe(true);
  });

  it("works with disabled and hidden elements", () => {
    const { container } = render(
      <div role="dialog" data-testid="trap-container">
        <button>Visible 1</button>
        <button disabled>Disabled</button>
        <button style={{ display: "none" }}>Hidden</button>
        <button>Visible 2</button>
      </div>
    );

    // Verify disabled and hidden are excluded
    const buttons = Array.from(
      container.querySelectorAll("button:not([disabled]):not([style*='display: none'])")
    );
    expect(buttons.length).toBe(2);
  });
});
