const { EventBus } = require("../services/eventBus");

describe("EventBus", () => {
	test("delivers a standard envelope asynchronously through the local fallback", async () => {
		const bus = new EventBus({ redisUrl: "" });
		const handler = jest.fn();
		await bus.subscribe("game.ended", handler);

		let synchronous = true;
		const publishing = bus.publish("game.ended", { gameCode: "GAME1" });
		expect(handler).not.toHaveBeenCalled();
		synchronous = false;
		const envelope = await publishing;

		expect(synchronous).toBe(false);
		expect(handler).toHaveBeenCalledWith(envelope);
		expect(envelope).toEqual({
			eventId: expect.any(String),
			type: "game.ended",
			timestamp: expect.any(String),
			payload: { gameCode: "GAME1" },
		});
	});

	test("publishes serialized events through Redis when available", async () => {
		const publisher = {
			on: jest.fn(),
			connect: jest.fn().mockResolvedValue(),
			publish: jest.fn().mockResolvedValue(1),
			quit: jest.fn().mockResolvedValue(),
		};
		const subscriber = {
			on: jest.fn(),
			connect: jest.fn().mockResolvedValue(),
			subscribe: jest.fn().mockResolvedValue(),
			quit: jest.fn().mockResolvedValue(),
		};
		publisher.duplicate = jest.fn(() => subscriber);
		const bus = new EventBus({
			redisUrl: "redis://test",
			createRedisClient: jest.fn(() => publisher),
		});

		await bus.subscribe("game.ended", jest.fn());
		const envelope = await bus.publish("game.ended", { gameCode: "GAME2" });

		expect(subscriber.subscribe).toHaveBeenCalledWith("game.ended", expect.any(Function));
		expect(publisher.publish).toHaveBeenCalledWith("game.ended", JSON.stringify(envelope));
	});
});
