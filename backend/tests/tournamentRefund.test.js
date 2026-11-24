jest.mock("../models/tournamentModel", () => ({
	getTournament: jest.fn(),
	getParticipants: jest.fn(),
	ensureRefundEntries: jest.fn(),
	updateTournamentStatus: jest.fn(),
	listRefundEntries: jest.fn(),
	claimRefundEntry: jest.fn(),
	markRefundResult: jest.fn(),
}));
jest.mock("../models/gameModel", () => ({}));
jest.mock("../services/escrowService", () => ({ refundTournamentBatch: jest.fn() }));
jest.mock("../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const model = require("../models/tournamentModel");
const escrow = require("../services/escrowService");
const tournamentService = require("../services/tournamentService");

// In-memory ledger emulating the table's atomic claim semantics.
function useLedger(initial) {
	const ledger = new Map(initial.map((e) => [e.wallet_address, { ...e }]));
	model.ensureRefundEntries.mockImplementation(async (rows) => {
		rows.forEach((r) => {
			if (!ledger.has(r.wallet_address)) ledger.set(r.wallet_address, { ...r, status: "pending" });
		});
	});
	model.listRefundEntries.mockImplementation(async () => [...ledger.values()].map((e) => ({ ...e })));
	model.claimRefundEntry.mockImplementation(async (_t, wallet, from = ["pending", "failed"]) => {
		const e = ledger.get(wallet);
		if (!e || !from.includes(e.status)) return null;
		e.status = "processing";
		return { ...e };
	});
	model.markRefundResult.mockImplementation(async (_t, wallet, { txHash, error }) => {
		const e = ledger.get(wallet);
		e.status = error ? "failed" : "refunded";
		e.tx_hash = txHash || null;
	});
	return ledger;
}

const wallets = ["GA1", "GA2", "GA3"];

beforeEach(() => {
	jest.clearAllMocks();
	model.getTournament.mockResolvedValue({ id: "t1", status: "open", entry_fee: 10 });
	model.getParticipants.mockResolvedValue(wallets.map((w) => ({ wallet_address: w })));
});

describe("tournament cancellation refunds", () => {
	test("refunds every participant, records hashes, cancels and broadcasts", async () => {
		useLedger([]);
		escrow.refundTournamentBatch.mockImplementation(async (_t, entries) =>
			entries.map((e) => ({ wallet_address: e.wallet_address, ok: true, hash: `h-${e.wallet_address}` })),
		);
		const emit = jest.fn();
		const io = { to: jest.fn(() => ({ emit })) };

		const result = await tournamentService.cancelTournament("t1", "no quorum", { io });

		expect(model.updateTournamentStatus).toHaveBeenCalledWith("t1", "cancelled", { cancellation_reason: "no quorum" });
		expect(result.refunded).toBe(3);
		expect(result.failed).toBe(0);
		expect(result.entries.map((e) => e.tx_hash).sort()).toEqual(["h-GA1", "h-GA2", "h-GA3"]);
		expect(io.to).toHaveBeenCalledWith("tournament:t1");
		expect(emit).toHaveBeenCalledWith("tournament:cancelled", expect.objectContaining({ reason: "no quorum", refunded: 3 }));
	});

	test("partial failure then retry refunds only the failed player exactly once", async () => {
		useLedger([]);
		escrow.refundTournamentBatch.mockImplementationOnce(async (_t, entries) =>
			entries.map((e) =>
				e.wallet_address === "GA2"
					? { wallet_address: "GA2", ok: false, error: "network down" }
					: { wallet_address: e.wallet_address, ok: true, hash: `h-${e.wallet_address}` },
			),
		);
		const first = await tournamentService.cancelTournament("t1", "organizer");
		expect(first.refunded).toBe(2);
		expect(first.failed).toBe(1);

		model.getTournament.mockResolvedValue({ id: "t1", status: "cancelled", entry_fee: 10 });
		escrow.refundTournamentBatch.mockImplementationOnce(async (_t, entries) =>
			entries.map((e) => ({ wallet_address: e.wallet_address, ok: true, hash: "h-retry" })),
		);
		const second = await tournamentService.cancelTournament("t1", "organizer");

		expect(escrow.refundTournamentBatch.mock.calls[1][1].map((e) => e.wallet_address)).toEqual(["GA2"]);
		expect(second.refunded).toBe(3);
		expect(model.updateTournamentStatus).toHaveBeenCalledTimes(1);
	});

	test("a fully refunded cancelled tournament never pays again", async () => {
		useLedger(wallets.map((w) => ({ tournament_id: "t1", wallet_address: w, amount: 10, status: "refunded" })));
		model.getTournament.mockResolvedValue({ id: "t1", status: "cancelled", entry_fee: 10 });
		escrow.refundTournamentBatch.mockResolvedValue([]);

		const result = await tournamentService.cancelTournament("t1", "again");

		expect(escrow.refundTournamentBatch).toHaveBeenCalledWith("t1", [], expect.any(Object));
		expect(result.refunded).toBe(3);
	});

	test("skips entries already claimed by a concurrent worker", async () => {
		useLedger(wallets.map((w) => ({ tournament_id: "t1", wallet_address: w, amount: 10, status: "processing" })));
		escrow.refundTournamentBatch.mockResolvedValue([]);
		const result = await tournamentService.cancelTournament("t1", "x");
		expect(result.inFlight).toBe(3);
		expect(model.claimRefundEntry).not.toHaveBeenCalled();
	});

	test("rejects tournaments that already started", async () => {
		model.getTournament.mockResolvedValue({ id: "t1", status: "in_progress", entry_fee: 10 });
		await expect(tournamentService.cancelTournament("t1", "x")).rejects.toThrow(/not started/);
		expect(model.updateTournamentStatus).not.toHaveBeenCalled();
	});

	test("rejects unknown tournaments", async () => {
		model.getTournament.mockResolvedValue(null);
		await expect(tournamentService.cancelTournament("nope", "x")).rejects.toThrow(/not found/);
	});

	test("free tournaments cancel without any refunds", async () => {
		model.getTournament.mockResolvedValue({ id: "t1", status: "open", entry_fee: 0 });
		const result = await tournamentService.cancelTournament("t1", "x");
		expect(escrow.refundTournamentBatch).not.toHaveBeenCalled();
		expect(result.status).toBe("cancelled");
	});
});
