import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MoveBadge from "../../src/components/analysis/MoveBadge";

describe("MoveBadge Component", () => {
	describe("Rendering", () => {
		it("renders the badge with the correct glyph and color class", () => {
			const { container } = render(
				<MoveBadge quality="blunder" cpl={150} evalBefore={null} evalAfter={null} />
			);
			const badge = container.querySelector(".acc-badge");
			expect(badge).toHaveClass("acc-blunder");
			expect(badge?.textContent).toContain("??");
		});

		it("renders different glyphs for each quality", () => {
			const qualities = [
				{ quality: "best" as const, glyph: "!" },
				{ quality: "good" as const, glyph: "✓" },
				{ quality: "inaccuracy" as const, glyph: "?!" },
				{ quality: "mistake" as const, glyph: "?" },
				{ quality: "blunder" as const, glyph: "??" },
			];

			qualities.forEach(({ quality, glyph }) => {
				const { container, unmount } = render(
					<MoveBadge quality={quality} cpl={50} evalBefore={null} evalAfter={null} />
				);
				const badge = container.querySelector(".acc-badge");
				expect(badge?.textContent).toContain(glyph);
				unmount();
			});
		});

		it("renders all color classes correctly", () => {
			const classes = [
				{ quality: "best" as const, class: "acc-best" },
				{ quality: "good" as const, class: "acc-good" },
				{ quality: "inaccuracy" as const, class: "acc-inaccuracy" },
				{ quality: "mistake" as const, class: "acc-mistake" },
				{ quality: "blunder" as const, class: "acc-blunder" },
			];

			classes.forEach(({ quality, class: className }) => {
				const { container, unmount } = render(
					<MoveBadge quality={quality} cpl={50} evalBefore={null} evalAfter={null} />
				);
				const badge = container.querySelector(".acc-badge");
				expect(badge).toHaveClass(className);
				unmount();
			});
		});
	});

	describe("Accessibility", () => {
		it("has correct aria-label for best move", () => {
			render(
				<MoveBadge
					quality="best"
					cpl={10}
					evalBefore={null}
					evalAfter={null}
					isBest={true}
				/>
			);
			const badge = screen.getByRole("status");
			expect(badge).toHaveAttribute("aria-label", "Best move");
		});

		it("has correct aria-label for blunder with cp loss", () => {
			render(
				<MoveBadge
					quality="blunder"
					cpl={500}
					evalBefore={null}
					evalAfter={null}
				/>
			);
			const badge = screen.getByRole("status");
			expect(badge).toHaveAttribute("aria-label", "Blunder, lost 500 cp");
		});

		it("has correct aria-label for inaccuracy without cp loss", () => {
			render(
				<MoveBadge
					quality="inaccuracy"
					cpl={0}
					evalBefore={null}
					evalAfter={null}
				/>
			);
			const badge = screen.getByRole("status");
			expect(badge).toHaveAttribute("aria-label", "Inaccuracy");
		});

		it("is keyboard focusable", () => {
			render(
				<MoveBadge quality="mistake" cpl={100} evalBefore={null} evalAfter={null} />
			);
			const badge = screen.getByRole("status");
			expect(badge).toHaveAttribute("tabIndex", "0");
		});

		it("has a title attribute for hover tooltip fallback", () => {
			render(
				<MoveBadge quality="good" cpl={30} evalBefore={null} evalAfter={null} />
			);
			const badge = screen.getByRole("status");
			expect(badge).toHaveAttribute("title", "Good");
		});
	});

	describe("Tooltip Display", () => {
		it("does not show tooltip on initial render", () => {
			render(
				<MoveBadge quality="blunder" cpl={150} evalBefore={null} evalAfter={null} />
			);
			expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
		});

		it("shows tooltip on hover", async () => {
			const { container } = render(
				<MoveBadge quality="blunder" cpl={150} evalBefore={null} evalAfter={null} />
			);
			const badge = container.querySelector(".acc-badge");
			fireEvent.mouseEnter(badge!);
			await waitFor(() => {
				expect(screen.getByRole("tooltip")).toBeInTheDocument();
			});
		});

		it("hides tooltip on mouse leave", async () => {
			const { container } = render(
				<MoveBadge quality="blunder" cpl={150} evalBefore={null} evalAfter={null} />
			);
			const badge = container.querySelector(".acc-badge");
			fireEvent.mouseEnter(badge!);
			await waitFor(() => {
				expect(screen.getByRole("tooltip")).toBeInTheDocument();
			});
			fireEvent.mouseLeave(badge!);
			await waitFor(() => {
				expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
			});
		});

		it("shows tooltip on focus", async () => {
			const { container } = render(
				<MoveBadge quality="blunder" cpl={150} evalBefore={null} evalAfter={null} />
			);
			const badge = container.querySelector(".acc-badge") as HTMLElement;
			badge.focus();
			await waitFor(() => {
				expect(screen.getByRole("tooltip")).toBeInTheDocument();
			});
		});

		it("hides tooltip on blur", async () => {
			const { container } = render(
				<MoveBadge quality="blunder" cpl={150} evalBefore={null} evalAfter={null} />
			);
			const badge = container.querySelector(".acc-badge") as HTMLElement;
			badge.focus();
			await waitFor(() => {
				expect(screen.getByRole("tooltip")).toBeInTheDocument();
			});
			badge.blur();
			await waitFor(() => {
				expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
			});
		});

		it("dismisses tooltip on Escape key", async () => {
			const { container } = render(
				<MoveBadge quality="blunder" cpl={150} evalBefore={null} evalAfter={null} />
			);
			const badge = container.querySelector(".acc-badge") as HTMLElement;
			badge.focus();
			await waitFor(() => {
				expect(screen.getByRole("tooltip")).toBeInTheDocument();
			});
			fireEvent.keyDown(badge, { key: "Escape" });
			await waitFor(() => {
				expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
			});
		});
	});

	describe("Tooltip Content", () => {
		it("shows quality label in tooltip", async () => {
			const { container } = render(
				<MoveBadge quality="mistake" cpl={250} evalBefore={null} evalAfter={null} />
			);
			const badge = container.querySelector(".acc-badge");
			fireEvent.mouseEnter(badge!);
			await waitFor(() => {
				expect(screen.getByRole("tooltip")).toHaveTextContent("Mistake");
			});
		});

		it("includes cp loss in tooltip when cpl > 0", async () => {
			const { container } = render(
				<MoveBadge quality="inaccuracy" cpl={75} evalBefore={null} evalAfter={null} />
			);
			const badge = container.querySelector(".acc-badge");
			fireEvent.mouseEnter(badge!);
			await waitFor(() => {
				expect(screen.getByRole("tooltip")).toHaveTextContent("Lost 75 cp");
			});
		});

		it("does not include cp loss in tooltip when cpl = 0", async () => {
			const { container } = render(
				<MoveBadge quality="best" cpl={0} evalBefore={null} evalAfter={null} />
			);
			const badge = container.querySelector(".acc-badge");
			fireEvent.mouseEnter(badge!);
			await waitFor(() => {
				const tooltip = screen.getByRole("tooltip");
				expect(tooltip).toHaveTextContent("Best");
				expect(tooltip).not.toHaveTextContent("Lost");
			});
		});

		it("shows evaluation delta when both evals are available", async () => {
			const { container } = render(
				<MoveBadge
					quality="mistake"
					cpl={180}
					evalBefore={50}
					evalAfter={-130}
					bestLine={null}
				/>
			);
			const badge = container.querySelector(".acc-badge");
			fireEvent.mouseEnter(badge!);
			await waitFor(() => {
				expect(screen.getByRole("tooltip")).toHaveTextContent("+0.5 → -1.3");
			});
		});

		it("does not show delta when evals are missing", async () => {
			const { container } = render(
				<MoveBadge
					quality="mistake"
					cpl={180}
					evalBefore={null}
					evalAfter={null}
					bestLine={null}
				/>
			);
			const badge = container.querySelector(".acc-badge");
			fireEvent.mouseEnter(badge!);
			await waitFor(() => {
				const tooltip = screen.getByRole("tooltip");
				expect(tooltip).toHaveTextContent("Mistake");
				expect(tooltip).not.toHaveTextContent("→");
			});
		});

		it("shows best line in tooltip when available", async () => {
			const { container } = render(
				<MoveBadge
					quality="inaccuracy"
					cpl={120}
					evalBefore={100}
					evalAfter={-20}
					bestLine="e2-e4 ..."
				/>
			);
			const badge = container.querySelector(".acc-badge");
			fireEvent.mouseEnter(badge!);
			await waitFor(() => {
				expect(screen.getByRole("tooltip")).toHaveTextContent("Best: e2-e4 ...");
			});
		});

		it("omits best line when not provided", async () => {
			const { container } = render(
				<MoveBadge
					quality="good"
					cpl={40}
					evalBefore={100}
					evalAfter={60}
					bestLine={null}
				/>
			);
			const badge = container.querySelector(".acc-badge");
			fireEvent.mouseEnter(badge!);
			await waitFor(() => {
				const tooltip = screen.getByRole("tooltip");
				expect(tooltip).not.toHaveTextContent("Best:");
			});
		});
	});

	describe("aria-describedby Integration", () => {
		it("sets aria-describedby when tooltip is visible", async () => {
			const { container } = render(
				<MoveBadge quality="blunder" cpl={300} evalBefore={null} evalAfter={null} />
			);
			const badge = container.querySelector(".acc-badge") as HTMLElement;
			expect(badge).not.toHaveAttribute("aria-describedby");

			fireEvent.mouseEnter(badge);
			await waitFor(() => {
				expect(badge).toHaveAttribute("aria-describedby");
				const describedById = badge.getAttribute("aria-describedby");
				expect(describedById).toMatch(/^move-badge-tooltip-/);
				expect(screen.getByRole("tooltip")).toHaveAttribute("id", describedById);
			});
		});

		it("removes aria-describedby when tooltip is hidden", async () => {
			const { container } = render(
				<MoveBadge quality="blunder" cpl={300} evalBefore={null} evalAfter={null} />
			);
			const badge = container.querySelector(".acc-badge") as HTMLElement;
			fireEvent.mouseEnter(badge);
			await waitFor(() => {
				expect(badge).toHaveAttribute("aria-describedby");
			});
			fireEvent.mouseLeave(badge);
			await waitFor(() => {
				expect(badge).not.toHaveAttribute("aria-describedby");
			});
		});
	});

	describe("Edge Cases", () => {
		it("handles very large cp loss values", async () => {
			const { container } = render(
				<MoveBadge quality="blunder" cpl={5000} evalBefore={null} evalAfter={null} />
			);
			const badge = container.querySelector(".acc-badge");
			fireEvent.mouseEnter(badge!);
			await waitFor(() => {
				expect(screen.getByRole("tooltip")).toHaveTextContent("Lost 5000 cp");
			});
		});

		it("handles zero cp loss", async () => {
			const { container } = render(
				<MoveBadge quality="best" cpl={0} evalBefore={null} evalAfter={null} />
			);
			const badge = container.querySelector(".acc-badge");
			fireEvent.mouseEnter(badge!);
			await waitFor(() => {
				const tooltip = screen.getByRole("tooltip");
				expect(tooltip).toHaveTextContent("Best");
				expect(tooltip).not.toHaveTextContent("Lost 0");
			});
		});

		it("handles mate scores in evaluation delta", async () => {
			const { container } = render(
				<MoveBadge
					quality="blunder"
					cpl={100000}
					evalBefore={-100000} // mate loss
					evalAfter={100}
					bestLine={null}
				/>
			);
			const badge = container.querySelector(".acc-badge");
			fireEvent.mouseEnter(badge!);
			await waitFor(() => {
				expect(screen.getByRole("tooltip")).toHaveTextContent("-M");
				expect(screen.getByRole("tooltip")).toHaveTextContent("+0.1");
			});
		});

		it("does not crash with undefined optional props", () => {
			expect(() => {
				render(
					<MoveBadge quality="good" cpl={30} evalBefore={null} evalAfter={null} />
				);
			}).not.toThrow();
		});
	});

	describe("Keyboard Interaction", () => {
		it("does not dismiss tooltip on other keys", async () => {
			const { container } = render(
				<MoveBadge quality="blunder" cpl={150} evalBefore={null} evalAfter={null} />
			);
			const badge = container.querySelector(".acc-badge") as HTMLElement;
			badge.focus();
			await waitFor(() => {
				expect(screen.getByRole("tooltip")).toBeInTheDocument();
			});
			fireEvent.keyDown(badge, { key: "Enter" });
			await waitFor(() => {
				expect(screen.getByRole("tooltip")).toBeInTheDocument();
			});
		});

		it("focuses badge after dismissing with Escape", async () => {
			const { container } = render(
				<MoveBadge quality="blunder" cpl={150} evalBefore={null} evalAfter={null} />
			);
			const badge = container.querySelector(".acc-badge") as HTMLElement;
			badge.focus();
			const initialFocus = document.activeElement;

			fireEvent.keyDown(badge, { key: "Escape" });
			await waitFor(() => {
				expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
			});
		});
	});

	describe("Multiple Badges", () => {
		it("can render multiple badges independently", async () => {
			const { container } = render(
				<>
					<MoveBadge quality="best" cpl={10} evalBefore={null} evalAfter={null} />
					<MoveBadge quality="blunder" cpl={500} evalBefore={null} evalAfter={null} />
				</>
			);
			const badges = container.querySelectorAll(".acc-badge");
			expect(badges).toHaveLength(2);
			expect(badges[0]).toHaveClass("acc-best");
			expect(badges[1]).toHaveClass("acc-blunder");
		});

		it("manages tooltips independently for multiple badges", async () => {
			const { container } = render(
				<>
					<MoveBadge
						quality="best"
						cpl={10}
						evalBefore={null}
						evalAfter={null}
						isBest={true}
					/>
					<MoveBadge quality="blunder" cpl={500} evalBefore={null} evalAfter={null} />
				</>
			);
			const badges = container.querySelectorAll(".acc-badge");
			fireEvent.mouseEnter(badges[0]);
			await waitFor(() => {
				const tooltip = screen.getByRole("tooltip");
				expect(tooltip).toHaveTextContent("Best");
			});
		});
	});
});
