import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import Toast, { MAX_VISIBLE_TOASTS, TOAST_EXIT_MS } from "../Toast";
import { useToastStore, type ToastType } from "../../store/toastStore";

const add = (message: string, type: ToastType = "info") =>
	act(() => useToastStore.getState().addToast(message, type));

const advance = (ms: number) =>
	act(() => {
		vi.advanceTimersByTime(ms);
	});

const bar = (el: HTMLElement) =>
	Number(el.querySelector('[role="progressbar"]')!.getAttribute("aria-valuenow"));

describe("Toast (#585)", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		useToastStore.setState({ toasts: [] });
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("renders a countdown progress bar that decays with time", () => {
		render(<Toast />);
		add("Saved", "success");
		const toast = screen.getByTestId("toast");
		expect(bar(toast)).toBe(100);

		advance(2500);
		expect(bar(toast)).toBe(50);
	});

	it("auto-dismisses after the duration, then plays the exit animation", () => {
		render(<Toast />);
		add("Bye", "info");
		advance(5000);
		expect(screen.getByTestId("toast").className).toContain("opacity-0");
		advance(TOAST_EXIT_MS);
		expect(screen.queryByTestId("toast")).toBeNull();
		expect(useToastStore.getState().toasts).toHaveLength(0);
	});

	it("uses a shorter duration for invitations", () => {
		render(<Toast />);
		add("Join me", "invitation");
		advance(3000 + TOAST_EXIT_MS);
		expect(screen.queryByTestId("toast")).toBeNull();
	});

	it("pauses the progress bar and dismiss timer on hover and resumes on leave", () => {
		render(<Toast />);
		add("Hover me", "info");
		const toast = screen.getByTestId("toast");

		advance(2000);
		fireEvent.mouseEnter(toast);
		const pausedAt = bar(toast);
		expect(pausedAt).toBe(60);
		expect(toast.getAttribute("data-paused")).toBe("true");

		advance(10000);
		expect(bar(toast)).toBe(pausedAt);
		expect(screen.getByTestId("toast")).toBeTruthy();

		fireEvent.mouseLeave(toast);
		advance(1000);
		expect(bar(toast)).toBe(40);
		advance(2000 + TOAST_EXIT_MS);
		expect(screen.queryByTestId("toast")).toBeNull();
	});

	it("pauses on keyboard focus and resumes after focus leaves", () => {
		render(<Toast />);
		add("Focus me", "error");
		const toast = screen.getByTestId("toast");
		const dismiss = screen.getByLabelText("Dismiss");

		advance(1000);
		fireEvent.focus(dismiss);
		const pausedAt = bar(toast);
		expect(pausedAt).toBe(80);
		expect(toast.getAttribute("data-paused")).toBe("true");

		advance(10000);
		expect(bar(toast)).toBe(pausedAt);

		fireEvent.blur(dismiss);
		advance(1000);
		expect(bar(toast)).toBe(60);
	});

	it("stays paused while either hover or focus remains active", () => {
		render(<Toast />);
		add("Hover and focus", "info");
		const toast = screen.getByTestId("toast");
		const dismiss = screen.getByLabelText("Dismiss");

		fireEvent.focus(dismiss);
		fireEvent.mouseEnter(toast);
		fireEvent.mouseLeave(toast);
		expect(toast.getAttribute("data-paused")).toBe("true");

		advance(10000);
		expect(bar(toast)).toBe(100);

		fireEvent.blur(dismiss);
		advance(1000);
		expect(toast.getAttribute("data-paused")).toBe("false");
		expect(bar(toast)).toBe(80);
	});

	it("dismisses immediately when the close button is clicked", () => {
		render(<Toast />);
		add("Close me", "error");
		fireEvent.click(screen.getByLabelText("Dismiss"));
		advance(TOAST_EXIT_MS);
		expect(screen.queryByTestId("toast")).toBeNull();
	});

	it("never auto-dismisses loading toasts and shows no countdown", () => {
		render(<Toast />);
		add("Working...", "loading");
		advance(60000);
		const toast = screen.getByTestId("toast");
		expect(toast.querySelector('[role="progressbar"]')).toBeNull();
	});

	it("stacks at most four toasts and queues the rest in FIFO order", () => {
		render(<Toast />);
		for (let i = 1; i <= 6; i++) add(`Toast ${i}`, "info");

		expect(screen.getAllByTestId("toast")).toHaveLength(MAX_VISIBLE_TOASTS);
		expect(screen.queryByText("Toast 5")).toBeNull();
		expect(screen.getByText("Toast 1")).toBeTruthy();

		fireEvent.click(screen.getAllByLabelText("Dismiss")[0]);
		advance(TOAST_EXIT_MS);
		expect(screen.queryByText("Toast 1")).toBeNull();
		expect(screen.getByText("Toast 5")).toBeTruthy();
		expect(screen.queryByText("Toast 6")).toBeNull();
	});

	it("starts a queued toast's countdown only once it becomes visible", () => {
		render(<Toast />);
		for (let i = 1; i <= 5; i++) add(`Toast ${i}`, "info");
		advance(4000);
		fireEvent.click(screen.getAllByLabelText("Dismiss")[0]);
		advance(TOAST_EXIT_MS);
		const queued = screen.getByText("Toast 5").closest('[data-testid="toast"]') as HTMLElement;
		expect(bar(queued)).toBeGreaterThanOrEqual(95);
	});

	it("gives toasts added in the same millisecond distinct ids", () => {
		const a = add("a");
		const b = add("b");
		expect(a).not.toBe(b);
	});

	it("runs an invitation action and dismisses the toast", () => {
		const onClick = vi.fn();
		render(<Toast />);
		act(() => {
			useToastStore.getState().addToast("Invite", "invitation", { label: "Accept", onClick });
		});
		fireEvent.click(screen.getByText("Accept"));
		expect(onClick).toHaveBeenCalledOnce();
		advance(TOAST_EXIT_MS);
		expect(screen.queryByTestId("toast")).toBeNull();
	});
});
