const { EventEmitter } = require("events");
const { randomUUID } = require("crypto");

class EventBus {
	constructor({ redisUrl = process.env.REDIS_URL, createRedisClient, logger = console } = {}) {
		this.redisUrl = redisUrl;
		this.createRedisClient = createRedisClient;
		this.logger = logger;
		this.localEmitter = new EventEmitter();
		this.publisher = null;
		this.subscriber = null;
		this.redisReady = false;
		this.connectPromise = null;
		this.redisSubscriptions = new Set();
	}

	createEnvelope(type, payload) {
		return {
			eventId: randomUUID(),
			type,
			timestamp: new Date().toISOString(),
			payload,
		};
	}

	async connect() {
		if (!this.redisUrl) return false;
		if (this.redisReady) return true;
		if (this.connectPromise) return this.connectPromise;

		this.connectPromise = (async () => {
			try {
				const createClient = this.createRedisClient || require("redis").createClient;
				this.publisher = createClient({
					url: this.redisUrl,
					socket: {
						connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT_MS) || 1000,
						reconnectStrategy: false,
					},
				});
				this.subscriber = this.publisher.duplicate();
				this.publisher.on("error", (error) => this._handleRedisError(error));
				this.subscriber.on("error", (error) => this._handleRedisError(error));
				await Promise.all([this.publisher.connect(), this.subscriber.connect()]);
				this.redisReady = true;
				return true;
			} catch (error) {
				this.redisReady = false;
				this.logger.warn(`[EventBus] Redis unavailable; using local delivery: ${error.message}`);
				return false;
			} finally {
				this.connectPromise = null;
			}
		})();

		return this.connectPromise;
	}

	_handleRedisError(error) {
		this.redisReady = false;
		this.logger.warn(`[EventBus] Redis error; local fallback enabled: ${error.message}`);
	}

	async _ensureRedisSubscription(type) {
		if (!this.redisReady || this.redisSubscriptions.has(type)) return;
		await this.subscriber.subscribe(type, (message) => {
			try {
				this.localEmitter.emit(type, JSON.parse(message));
			} catch (error) {
				this.logger.error(`[EventBus] Invalid ${type} event: ${error.message}`);
			}
		});
		this.redisSubscriptions.add(type);
	}

	async subscribe(type, handler) {
		if (!type || typeof handler !== "function") {
			throw new Error("Event type and handler are required");
		}

		const safeHandler = (envelope) => {
			Promise.resolve(handler(envelope)).catch((error) => {
				this.logger.error(`[EventBus] ${type} handler failed: ${error.message}`);
			});
		};
		this.localEmitter.on(type, safeHandler);
		if (await this.connect()) await this._ensureRedisSubscription(type);

		return () => this.localEmitter.off(type, safeHandler);
	}

	async publish(type, payload) {
		if (!type) throw new Error("Event type is required");
		const envelope = this.createEnvelope(type, payload);

		if (await this.connect()) {
			try {
				await this.publisher.publish(type, JSON.stringify(envelope));
				return envelope;
			} catch (error) {
				this._handleRedisError(error);
			}
		}

		await new Promise((resolve) => {
			setImmediate(() => {
				this.localEmitter.emit(type, envelope);
				resolve();
			});
		});
		return envelope;
	}

	async close() {
		const clients = [this.subscriber, this.publisher].filter(Boolean);
		await Promise.allSettled(clients.map((client) => client.isOpen ? client.quit() : undefined));
		this.redisReady = false;
		this.redisSubscriptions.clear();
		this.localEmitter.removeAllListeners();
	}
}

module.exports = new EventBus();
module.exports.EventBus = EventBus;
