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

module.exports = { moderateMessage, MAX_MESSAGE_LENGTH };
