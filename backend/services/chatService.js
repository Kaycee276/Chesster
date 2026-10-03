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

module.exports = { moderateMessage, MAX_MESSAGE_LENGTH, checkSlowMode };
