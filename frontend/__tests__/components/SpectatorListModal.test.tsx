// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { SpectatorPresence } from "../../src/api/socket";
import SpectatorListModal from "../../src/components/SpectatorListModal";
import { filterAndSortSpectators } from "../../src/utils/spectatorList";

const spectators: SpectatorPresence[] = [
	{ address: "GBZX-ALICE", name: "alice", rating: 1500, joinedAt: 3000, badge: "master" },
	{ address: "GCQW-BOB", name: "Bob", rating: 2100, joinedAt: 1000 },
	{ address: "GDRT-CAROL", joinedAt: 2000 },
	{ address: "GAAA-DAN", name: "Dan", rating: 1800 },
];

const names = (list: SpectatorPresence[]) => list.map((s) => s.name ?? s.address);

describe("filterAndSortSpectators", () => {
	it("matches name or address case-insensitively", () => {
		expect(names(filterAndSortSpectators(spectators, "BOB", "alphabetical"))).toEqual(["Bob"]);
		expect(names(filterAndSortSpectators(spectators, "gdrt", "alphabetical"))).toEqual([
			"GDRT-CAROL",
		]);
	});

	it("returns everyone for a blank query and does not mutate the input", () => {
		const before = spectators.map((s) => s.address);
		const result = filterAndSortSpectators(spectators, "   ", "rating");
		expect(result).toHaveLength(spectators.length);
		expect(spectators.map((s) => s.address)).toEqual(before);
	});

	it("sorts alphabetically by display name", () => {
		expect(names(filterAndSortSpectators(spectators, "", "alphabetical"))).toEqual([
			"alice",
			"Bob",
			"Dan",
			"GDRT-CAROL",
		]);
	});

	it("sorts by rating from highest, treating missing ratings as zero", () => {
		expect(names(filterAndSortSpectators(spectators, "", "rating"))).toEqual([
			"Bob",
			"Dan",
			"alice",
			"GDRT-CAROL",
		]);
	});

	it("sorts by join time from earliest, with missing join times last", () => {
		expect(names(filterAndSortSpectators(spectators, "", "joined"))).toEqual([
			"Bob",
			"GDRT-CAROL",
			"alice",
			"Dan",
		]);
	});
});

describe("SpectatorListModal", () => {
	const renderModal = (list: SpectatorPresence[], onClose = vi.fn()) =>
		render(<SpectatorListModal spectators={list} onClose={onClose} />);

	const listItems = () => screen.getAllByRole("listitem").map((item) => item.textContent ?? "");

	it("shows the live spectator count and every spectator by default", () => {
		renderModal(spectators);

		expect(screen.getByTestId("spectator-count").textContent).toBe("(4)");
		expect(screen.getAllByRole("listitem")).toHaveLength(4);
	});

	it("updates the count when the spectator list changes", () => {
		const { rerender } = renderModal(spectators);
		rerender(<SpectatorListModal spectators={spectators.slice(0, 2)} />);

		expect(screen.getByTestId("spectator-count").textContent).toBe("(2)");
		expect(screen.getAllByRole("listitem")).toHaveLength(2);
	});

	it("filters the list as the user types in the search box", () => {
		renderModal(spectators);

		fireEvent.change(screen.getByRole("searchbox"), { target: { value: "dan" } });

		expect(screen.getAllByRole("listitem")).toHaveLength(1);
		expect(listItems()[0]).toContain("Dan");
		// The header count reflects everyone watching, not the filtered view.
		expect(screen.getByTestId("spectator-count").textContent).toBe("(4)");
	});

	it("re-sorts when a sort option is picked", () => {
		renderModal(spectators);

		fireEvent.change(screen.getByLabelText("Sort spectators"), {
			target: { value: "rating" },
		});

		expect(listItems()[0]).toContain("Bob");
		expect(listItems()[0]).toContain("2100");
	});

	it("shows a badge label for distinguished spectators", () => {
		renderModal(spectators);

		expect(screen.getByText("Master")).toBeTruthy();
	});

	it("shows an empty state when nothing matches the search", () => {
		renderModal(spectators);

		fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzz" } });

		expect(screen.getByText("No spectators match your search.")).toBeTruthy();
		expect(screen.queryAllByRole("listitem")).toHaveLength(1);
	});

	it("calls onClose from the close button", () => {
		const onClose = vi.fn();
		renderModal(spectators, onClose);

		fireEvent.click(screen.getByLabelText("Close spectator list"));

		expect(onClose).toHaveBeenCalledTimes(1);
	});
});
