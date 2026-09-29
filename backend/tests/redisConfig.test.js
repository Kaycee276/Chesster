const net = require("net");

describe("config/redis", () => {
	const originalUrl = process.env.REDIS_URL;
	let redisConfig;
	let warn;

	beforeEach(() => {
		jest.resetModules();
		redisConfig = require("../config/redis");
		warn = jest.spyOn(console, "warn").mockImplementation(() => {});
	});

	afterEach(async () => {
		await redisConfig.closeRedis();
		warn.mockRestore();
		if (originalUrl === undefined) delete process.env.REDIS_URL;
		else process.env.REDIS_URL = originalUrl;
	});

	it("disables caching when REDIS_URL is not configured", () => {
		delete process.env.REDIS_URL;
		expect(redisConfig.getRedisClient()).toBeNull();
	});

	it("returns no client (so callers use the database) while Redis is unreachable", async () => {
		// Grab a free port and release it so nothing is listening there.
		const port = await new Promise((resolve) => {
			const server = net.createServer().listen(0, () => {
				const { port: free } = server.address();
				server.close(() => resolve(free));
			});
		});
		process.env.REDIS_URL = `redis://127.0.0.1:${port}`;

		expect(redisConfig.getRedisClient()).toBeNull();
		await new Promise((resolve) => setTimeout(resolve, 300));
		expect(redisConfig.getRedisClient()).toBeNull();
		expect(warn).toHaveBeenCalledTimes(1);
	});
});
