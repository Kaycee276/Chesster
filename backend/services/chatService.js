const { getRedisConnection } = require("../config/redis");

const MAX_MESSAGE_LENGTH = 500;
const DEFAULT_BLOCKED_TERMS = [
  'fuck',
  'shit',
  'bitch',
  'asshole',
  'cunt',
  'bastard',
  'damn',
  'dick',
  'piss',
  'slut',
  'whore',
];
const SPECTATOR_MESSAGE_THROTTLE_MS = 3000;
const DUPLICATE_SPAM_MAX = 3;
const DUPLICATE_SPAM_WINDOW_MS = 10 * 1000;
const CHAT_SPAM_DETECTED = 'CHAT_SPAM_DETECTED';

const terms = () => (process.env.CHAT_BLOCKED_TERMS
  ? process.env.CHAT_BLOCKED_TERMS.split(',').map((term) => term.trim().toLowerCase()).filter(Boolean)
  : DEFAULT_BLOCKED_TERMS);

/**
 * Truncate sequences of 4 or more identical consecutive characters down to 2
 * (e.g. "noooooooo!!!!!!" -> "noo!!").
 *
 * @param {string} text
 * @returns {string}
 */
function truncateRepeatedChars(text) {
  if (!text || typeof text !== 'string') return '';
  return text.replace(/(.)\1{3,}/g, '$1$1');
}

/**
 * Mask recognized profane words with asterisks of equal length while preserving
 * benign words that merely contain blocked substrings.
 *
 * @param {string} text
 * @returns {string}
 */
function filterProfanity(text) {
  if (!text || typeof text !== 'string') return '';
  let filtered = text;
  for (const term of terms()) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filtered = filtered.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), (match) => '*'.repeat(match.length));
  }
  return filtered;
}

/**
 * Sanitize a chat message by stripping control characters and HTML tags,
 * truncating excessive character repetition (4+ -> 2), masking profanity,
 * trimming whitespace, and enforcing MAX_MESSAGE_LENGTH.
 *
 * @param {string} text
 * @returns {string}
 */
function sanitizeChatMessage(text) {
  if (!text || typeof text !== 'string') return '';
  const stripped = text
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/<[^>]*>/g, '');
  const collapsed = truncateRepeatedChars(stripped);
  const masked = filterProfanity(collapsed);
  return masked.trim().slice(0, MAX_MESSAGE_LENGTH);
}

function moderateMessage(message) {
  const clean = String(message ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/<[^>]*>/g, '')
    .trim()
    .slice(0, MAX_MESSAGE_LENGTH);
  if (!clean) return { accepted: false, message: '' };

  const moderated = filterProfanity(clean);
  return { accepted: true, message: moderated };
}

/**
 * Duplicate message spam detector (sliding window, per user).
 *
 * Rejects messages when a user sends DUPLICATE_SPAM_MAX (3) or more identical
 * messages within a rolling DUPLICATE_SPAM_WINDOW_MS (10s) window.
 */
const duplicateSpamBuckets = new Map(); // userId -> Array<{ text: string, sentAt: number }>

/**
 * Check whether `message` from `userId` constitutes duplicate spam within the
 * sliding window. Returns `true` if duplicate spam is detected, `false` otherwise.
 *
 * @param {string} userId
 * @param {string} message
 * @param {{ now?: number, max?: number, windowMs?: number }} [options]
 * @returns {boolean}
 */
function checkDuplicateSpam(userId, message, {
  now = Date.now(),
  max = DUPLICATE_SPAM_MAX,
  windowMs = DUPLICATE_SPAM_WINDOW_MS,
} = {}) {
  if (!userId || typeof message !== 'string') return false;
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;

  const windowStart = now - windowMs;
  const recent = (duplicateSpamBuckets.get(userId) || []).filter((entry) => entry.sentAt > windowStart);

  const duplicateCount = recent.reduce((acc, entry) => (entry.text === normalized ? acc + 1 : acc), 0);
  if (duplicateCount + 1 >= max) {
    duplicateSpamBuckets.set(userId, recent);
    return true;
  }

  recent.push({ text: normalized, sentAt: now });
  duplicateSpamBuckets.set(userId, recent);
  return false;
}

/**
 * Validate a chat message against duplicate spam and return the sanitized text.
 * Throws an Error with code `CHAT_SPAM_DETECTED` when duplicate spam is detected.
 *
 * @param {string} userId
 * @param {string} message
 * @param {{ now?: number, max?: number, windowMs?: number }} [options]
 * @returns {string}
 */
function processChatMessage(userId, message, options = {}) {
  if (checkDuplicateSpam(userId, message, options)) {
    const err = new Error('Duplicate spam detected. Please avoid sending the same message repeatedly.');
    err.code = CHAT_SPAM_DETECTED;
    throw err;
  }
  return sanitizeChatMessage(message);
}

/** Drop all duplicate-spam history for a user (call on disconnect). */
function clearDuplicateSpam(userId) {
  return duplicateSpamBuckets.delete(userId);
}

function resetDuplicateSpam() {
  duplicateSpamBuckets.clear();
}

/**
 * Spectator chat slow-mode rate limiter (per-IP, 5-second cooldown).
 * 
 * Tracks message timestamps per IP address to enforce a fixed-window slow-mode cooldown.
 * Matches the per-IP keying convention used elsewhere in the codebase (HTTP rate limiter).
 * 
 * NOTE: The issue Context section mentions "5-second slow mode per IP", while the technical
 * guidance snippet shows `checkSlowMode(socket.id, 5000)` (per-socket). We implement per-IP
 * to be consistent with the HTTP rate-limiter convention elsewhere in this repo. The PR
 * description flags this discrepancy for maintainer confirmation of intent.
 */
const spectatorSlowMode = new Map(); // key (IP) -> { lastMessageAt, windowMs }

function checkSlowMode(key, windowMs) {
  const now = Date.now();
  const entry = spectatorSlowMode.get(key);

  if (!entry || now >= entry.lastMessageAt + windowMs) {
    spectatorSlowMode.set(key, { lastMessageAt: now, windowMs });
    return { allowed: true, nextAvailableIn: 0 };
  }

  const nextAvailableIn = Math.ceil((entry.lastMessageAt + windowMs - now) / 1000);
  return { allowed: false, nextAvailableIn };
}

function resetSlowMode() {
  spectatorSlowMode.clear();
}

/**
 * In-game player chat rate limiter (sliding window, per socket and game room).
 *
 * Each socket may send at most CHAT_RATE_LIMIT_MAX messages to a given game
 * room within any rolling CHAT_RATE_LIMIT_WINDOW_MS window. Accepted message
 * timestamps are kept per socket so that all of a socket's state can be
 * dropped in O(1) when it disconnects.
 */
const CHAT_RATE_LIMIT_MAX = 5;
const CHAT_RATE_LIMIT_WINDOW_MS = 10 * 1000;
const CHAT_RATE_LIMIT_EVENT = 'chat_rate_limit_exceeded';

const chatRateBuckets = new Map(); // socketId -> Map(room -> accepted timestamps[])

function consumeChatToken(socketId, room, {
  now = Date.now(),
  max = CHAT_RATE_LIMIT_MAX,
  windowMs = CHAT_RATE_LIMIT_WINDOW_MS,
} = {}) {
  let rooms = chatRateBuckets.get(socketId);
  if (!rooms) {
    rooms = new Map();
    chatRateBuckets.set(socketId, rooms);
  }
  const windowStart = now - windowMs;
  const timestamps = (rooms.get(room) || []).filter((sentAt) => sentAt > windowStart);

  if (timestamps.length >= max) {
    rooms.set(room, timestamps);
    return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, timestamps[0] + windowMs - now) };
  }

  timestamps.push(now);
  rooms.set(room, timestamps);
  return { allowed: true, remaining: max - timestamps.length, retryAfterMs: 0 };
}

/**
 * Consume a chat token for `socket` in `room`. When the limit is exceeded the
 * socket receives a structured `error` event and a dedicated
 * `chat_rate_limit_exceeded` event, and `false` is returned so the caller can
 * drop the message before moderation, persistence or broadcast.
 */
function enforceChatRateLimit(socket, room, options = {}) {
  const result = consumeChatToken(socket.id, room, options);
  if (result.allowed) return true;

  const payload = {
    error: CHAT_RATE_LIMIT_EVENT,
    code: CHAT_RATE_LIMIT_EVENT,
    message: `Chat rate limit exceeded. Please wait ${Math.ceil(result.retryAfterMs / 1000)}s before sending another message.`,
    gameCode: room,
    limit: options.max ?? CHAT_RATE_LIMIT_MAX,
    windowMs: options.windowMs ?? CHAT_RATE_LIMIT_WINDOW_MS,
    retryAfterMs: result.retryAfterMs,
  };
  if (socket && typeof socket.emit === 'function') {
    socket.emit('error', payload);
    socket.emit(CHAT_RATE_LIMIT_EVENT, payload);
  }
  return false;
}

/** Drop all rate limiter state for a socket (call on disconnect). */
function clearChatRateLimit(socketId) {
  return chatRateBuckets.delete(socketId);
}

function resetChatRateLimits() {
  chatRateBuckets.clear();
}

/**
 * Check if a spectator can send a chat message based on Redis-backed throttling.
 * Per spectator (by wallet address or IP), enforce a 3-second delay between messages
 * in a given game channel.
 *
 * @param {string} gameId - The game ID
 * @param {string} userId - The spectator's wallet address or IP
 * @returns {Promise<{ allowed: boolean, nextAvailableIn: number }>}
 */
async function canSpectatorSendMessage(gameId, userId) {
  if (!gameId || !userId) return { allowed: false, nextAvailableIn: 0 };

  const client = await getRedisConnection();
  if (!client) {
    // Redis unavailable, allow message (graceful degradation)
    return { allowed: true, nextAvailableIn: 0 };
  }

  const key = `ratelimit:chat:${gameId}:${userId}`;
  try {
    const exists = await client.get(key);
    if (exists) {
      const ttl = await client.ttl(key);
      const nextAvailableIn = Math.max(1, ttl);
      return { allowed: false, nextAvailableIn };
    }

    // Set throttle key with 3-second expiry
    await client.set(key, '1', 'EX', Math.ceil(SPECTATOR_MESSAGE_THROTTLE_MS / 1000));
    return { allowed: true, nextAvailableIn: 0 };
  } catch (err) {
    // Redis error, log and allow message (graceful degradation)
    console.error(`[chatService] Redis throttle check failed for ${gameId}:${userId}:`, err.message);
    return { allowed: true, nextAvailableIn: 0 };
  }
}

module.exports = {
  moderateMessage,
  filterProfanity,
  truncateRepeatedChars,
  sanitizeChatMessage,
  checkDuplicateSpam,
  processChatMessage,
  clearDuplicateSpam,
  resetDuplicateSpam,
  duplicateSpamBuckets,
  DUPLICATE_SPAM_MAX,
  DUPLICATE_SPAM_WINDOW_MS,
  CHAT_SPAM_DETECTED,
  MAX_MESSAGE_LENGTH,
  checkSlowMode,
  resetSlowMode,
  CHAT_RATE_LIMIT_MAX,
  CHAT_RATE_LIMIT_WINDOW_MS,
  CHAT_RATE_LIMIT_EVENT,
  consumeChatToken,
  enforceChatRateLimit,
  clearChatRateLimit,
  resetChatRateLimits,
  chatRateBuckets,
  SPECTATOR_MESSAGE_THROTTLE_MS,
  canSpectatorSendMessage,
};

