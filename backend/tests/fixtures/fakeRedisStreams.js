/**
 * Minimal in-memory Redis Streams + string-key fake for tests.
 *
 * ioredis-mock has no consumer group support (XGROUP/XREADGROUP/XCLAIM), so
 * this fake implements just what the matchmaking queue needs, with the same
 * semantics as Redis: every command is atomic, each entry is delivered to
 * exactly one consumer of a group, and delivered entries stay pending until
 * XACK. Every command yields to the event loop first, so concurrent workers
 * genuinely interleave between commands instead of running one after another.
 */
class FakeRedisStreams {
	constructor({ now = () => Date.now() } = {}) {
		this.now = now;
		this.streams = new Map(); // key -> { entries: [{id, fields}], seq, groups: Map }
		this.strings = new Map(); // key -> { value, expiresAt }
		this.commandCount = 0;
	}

	_stream(key, create = false) {
		let stream = this.streams.get(key);
		if (!stream && create) {
			stream = { entries: [], seq: 0, groups: new Map() };
			this.streams.set(key, stream);
		}
		return stream;
	}

	_group(key, name) {
		const group = this._stream(key)?.groups.get(name);
		if (!group) throw new Error(`NOGROUP No such key '${key}' or consumer group '${name}'`);
		return group;
	}

	async _tick() {
		this.commandCount += 1;
		await Promise.resolve();
	}

	static _compareIds(a, b) {
		const [am, as] = a.split("-").map(Number);
		const [bm, bs] = b.split("-").map(Number);
		return am - bm || as - bs;
	}

	async xgroup(action, key, name, startId, ...rest) {
		await this._tick();
		if (String(action).toUpperCase() !== "CREATE") throw new Error("ERR unsupported XGROUP subcommand");
		let stream = this._stream(key);
		if (!stream) {
			if (!rest.includes("MKSTREAM")) throw new Error("ERR The XGROUP subcommand requires the key to exist");
			stream = this._stream(key, true);
		}
		if (stream.groups.has(name)) throw new Error("BUSYGROUP Consumer Group name already exists");
		const lastId = stream.entries.length ? stream.entries[stream.entries.length - 1].id : "0-0";
		stream.groups.set(name, {
			lastDelivered: startId === "$" ? lastId : "0-0",
			pending: new Map(), // id -> { consumer, deliveredAt, deliveries }
		});
		return "OK";
	}

	async xadd(key, id, ...fields) {
		await this._tick();
		const stream = this._stream(key, true);
		stream.seq += 1;
		const entryId = id === "*" ? `${this.now()}-${stream.seq}` : id;
		// Keep ids strictly increasing even if the injected clock stands still or moves back.
		const last = stream.entries[stream.entries.length - 1];
		const finalId = last && FakeRedisStreams._compareIds(entryId, last.id) <= 0
			? `${last.id.split("-")[0]}-${Number(last.id.split("-")[1]) + 1}`
			: entryId;
		stream.entries.push({ id: finalId, fields: fields.map(String) });
		return finalId;
	}

	async xreadgroup(...args) {
		await this._tick();
		const upper = args.map((arg) => (typeof arg === "string" ? arg.toUpperCase() : arg));
		const [groupName, consumer] = [args[upper.indexOf("GROUP") + 1], args[upper.indexOf("GROUP") + 2]];
		const countIndex = upper.indexOf("COUNT");
		const count = countIndex >= 0 ? Number(args[countIndex + 1]) : Infinity;
		const streamsIndex = upper.indexOf("STREAMS");
		const key = args[streamsIndex + 1];
		const group = this._group(key, groupName);
		const stream = this._stream(key);

		const fresh = stream.entries
			.filter((entry) => FakeRedisStreams._compareIds(entry.id, group.lastDelivered) > 0)
			.slice(0, count);
		if (fresh.length === 0) return null;
		for (const entry of fresh) {
			group.pending.set(entry.id, { consumer, deliveredAt: this.now(), deliveries: 1 });
			group.lastDelivered = entry.id;
		}
		return [[key, fresh.map((entry) => [entry.id, [...entry.fields]])]];
	}

	async xack(key, groupName, ...ids) {
		await this._tick();
		const group = this._group(key, groupName);
		let acked = 0;
		for (const id of ids) if (group.pending.delete(id)) acked += 1;
		return acked;
	}

	async xpending(key, groupName, start, end, count) {
		await this._tick();
		const group = this._group(key, groupName);
		const rows = [];
		for (const id of [...group.pending.keys()].sort(FakeRedisStreams._compareIds)) {
			if (start !== "-" && FakeRedisStreams._compareIds(id, start) < 0) continue;
			if (end !== "+" && FakeRedisStreams._compareIds(id, end) > 0) continue;
			const info = group.pending.get(id);
			rows.push([id, info.consumer, this.now() - info.deliveredAt, info.deliveries]);
			if (rows.length >= count) break;
		}
		return rows;
	}

	async xclaim(key, groupName, consumer, minIdleMs, ...ids) {
		await this._tick();
		const group = this._group(key, groupName);
		const stream = this._stream(key);
		const claimed = [];
		for (const id of ids) {
			const info = group.pending.get(id);
			if (!info || this.now() - info.deliveredAt < Number(minIdleMs)) continue;
			const entry = stream.entries.find((candidate) => candidate.id === id);
			info.consumer = consumer;
			info.deliveredAt = this.now();
			info.deliveries += 1;
			claimed.push(entry ? [entry.id, [...entry.fields]] : null);
		}
		return claimed;
	}

	async xrange(key, start, end) {
		await this._tick();
		const stream = this._stream(key);
		if (!stream) return [];
		return stream.entries
			.filter((entry) => (start === "-" || FakeRedisStreams._compareIds(entry.id, start) >= 0)
				&& (end === "+" || FakeRedisStreams._compareIds(entry.id, end) <= 0))
			.map((entry) => [entry.id, [...entry.fields]]);
	}

	async xdel(key, ...ids) {
		await this._tick();
		const stream = this._stream(key);
		if (!stream) return 0;
		const before = stream.entries.length;
		stream.entries = stream.entries.filter((entry) => !ids.includes(entry.id));
		return before - stream.entries.length;
	}

	async xlen(key) {
		await this._tick();
		return this._stream(key)?.entries.length ?? 0;
	}

	/** SET key value [PX ms] [NX] */
	async set(key, value, ...options) {
		await this._tick();
		const upper = options.map((option) => (typeof option === "string" ? option.toUpperCase() : option));
		const existing = this.strings.get(key);
		const live = existing && (existing.expiresAt === null || existing.expiresAt > this.now());
		if (upper.includes("NX") && live) return null;
		const pxIndex = upper.indexOf("PX");
		this.strings.set(key, { value: String(value), expiresAt: pxIndex >= 0 ? this.now() + Number(options[pxIndex + 1]) : null });
		return "OK";
	}

	async get(key) {
		await this._tick();
		const existing = this.strings.get(key);
		return existing && (existing.expiresAt === null || existing.expiresAt > this.now()) ? existing.value : null;
	}

	async del(...keys) {
		await this._tick();
		let removed = 0;
		for (const key of keys) {
			if (this.strings.delete(key) || this.streams.delete(key)) removed += 1;
		}
		return removed;
	}

	/** Entries still pending for a group (test helper). */
	pendingIds(key, groupName) {
		return [...this._group(key, groupName).pending.keys()];
	}

	/** All entries of a stream as { id, ...fieldMap } (test helper). */
	entries(key) {
		return (this._stream(key)?.entries ?? []).map((entry) => {
			const fields = {};
			for (let i = 0; i < entry.fields.length; i += 2) fields[entry.fields[i]] = entry.fields[i + 1];
			return { id: entry.id, ...fields };
		});
	}
}

module.exports = FakeRedisStreams;
