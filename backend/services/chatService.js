const MAX_MESSAGE_LENGTH = 500;
const DEFAULT_BLOCKED_TERMS = ['fuck', 'shit', 'bitch', 'asshole', 'cunt'];

const terms = () => (process.env.CHAT_BLOCKED_TERMS
  ? process.env.CHAT_BLOCKED_TERMS.split(',').map((term) => term.trim().toLowerCase()).filter(Boolean)
  : DEFAULT_BLOCKED_TERMS);

function moderateMessage(message) {
  const clean = String(message ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/<[^>]*>/g, '')
    .trim()
    .slice(0, MAX_MESSAGE_LENGTH);
  if (!clean) return { accepted: false, message: '' };

  let moderated = clean;
  for (const term of terms()) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    moderated = moderated.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), (match) => '*'.repeat(match.length));
  }
  return { accepted: true, message: moderated };
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

module.exports = {
  moderateMessage,
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
};

