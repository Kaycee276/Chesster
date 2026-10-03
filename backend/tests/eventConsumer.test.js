jest.mock("../config/supabase", () => ({}));

const { EventConsumer } = require("../workers/eventConsumer");
const { EventBus } = require("../services/eventBus");

describe("EventConsumer", () => {
	test("executes Elo, webhook, and audit tasks for a game-ended event", async () => {
		const consumer = new EventConsumer({ logger: { error: jest.fn() } });
		consumer.updateElo = jest.fn().mockResolvedValue({ updated: true });
		consumer.webhooks = { notifyMatchResolved: jest.fn().mockResolvedValue({ delivered: true }) };
		consumer.archiveEvent = jest.fn().mockResolvedValue({ archived: true });
		const envelope = {
			type: "game.ended",
			payload: { gameId: "game-1", gameCode: "GAME1", winner: "white" },
		};

		const results = await consumer.handleGameEnded(envelope);

		expect(results.every((result) => result.status === "fulfilled")).toBe(true);
		expect(consumer.updateElo).toHaveBeenCalledWith(envelope.payload);
		expect(consumer.webhooks.notifyMatchResolved).toHaveBeenCalledWith(envelope.payload);
		expect(consumer.archiveEvent).toHaveBeenCalledWith(envelope);
	});

	test("runs remaining tasks when one subscriber task fails", async () => {
		const logger = { error: jest.fn() };
		const consumer = new EventConsumer({ logger });
		consumer.updateElo = jest.fn().mockRejectedValue(new Error("elo unavailable"));
		consumer.webhooks = { notifyMatchResolved: jest.fn().mockResolvedValue([]) };
		consumer.archiveEvent = jest.fn().mockResolvedValue({ archived: true });

		const results = await consumer.handleGameEnded({ type: "game.ended", payload: {} });

		expect(results.map((result) => result.status)).toEqual(["rejected", "fulfilled", "fulfilled"]);
		expect(consumer.archiveEvent).toHaveBeenCalled();
		expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("elo task failed"));
	});

	test("receives published events asynchronously through the local bus", async () => {
		const bus = new EventBus({ redisUrl: "" });
		const consumer = new EventConsumer({ bus });
		consumer.handleGameEnded = jest.fn().mockResolvedValue([]);
		consumer.handlePlayerRegistered = jest.fn().mockResolvedValue([]);
		await consumer.start();

		await bus.publish("game.ended", { gameCode: "GAME3" });
		await new Promise(setImmediate);

		expect(consumer.handleGameEnded).toHaveBeenCalledWith(expect.objectContaining({
			type: "game.ended",
			payload: { gameCode: "GAME3" },
		}));
		consumer.stop();
	});
});
