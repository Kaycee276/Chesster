'use strict';

/**
 * antiCheatService.js
 *
 * Tracks per-player move timing within each game and flags sessions that
 * exhibit statistically anomalous patterns consistent with engine assistance:
 *
 *  - Median move time far below human reaction thresholds
 *  - Very low variance (all moves take almost exactly the same time)
 *  - Suspiciously high proportion of "instant" moves (< 500 ms)
 *
 * Anomaly data is stored in-memory for the duration of a game and can be
 * queried by game controllers or logged for review. No blocking action is
 * taken here — flagging is informational and subject to manual review.
 */

// Thresholds
const MIN_HUMAN_MOVE_MS   = 500;   // moves faster than this are suspicious
const INSTANT_MOVE_RATIO  = 0.40;  // >40% instant moves → flag
const LOW_VARIANCE_STDDEV = 800;   // stddev < 800 ms across ≥10 moves → flag
const MIN_MOVES_TO_ANALYSE = 8;    // need at least this many moves before scoring

/** gameCode → { white: SessionData, black: SessionData } */
const sessions = new Map();

/**
 * @typedef {{ moveTimes: number[], lastMoveAt: number|null, flagged: boolean, reasons: string[] }} SessionData
 */

function getSession(gameCode, color) {
  if (!sessions.has(gameCode)) {
    sessions.set(gameCode, {
      white: { moveTimes: [], lastMoveAt: null, flagged: false, reasons: [] },
      black: { moveTimes: [], lastMoveAt: null, flagged: false, reasons: [] },
    });
  }
  return sessions.get(gameCode)[color];
}

function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr) {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((sum, v) => sum + (v - m) ** 2, 0) / arr.length);
}

/**
 * Record a move event and update the anomaly score for that player.
 *
 * @param {string} gameCode
 * @param {'white'|'black'} color
 * @returns {{ flagged: boolean, reasons: string[] }}
 */
function recordMove(gameCode, color) {
  const session = getSession(gameCode, color);
  const now = Date.now();

  if (session.lastMoveAt !== null) {
    const elapsed = now - session.lastMoveAt;
    session.moveTimes.push(elapsed);
    _analyse(session);
  }

  session.lastMoveAt = now;
  return { flagged: session.flagged, reasons: session.reasons };
}

function _analyse(session) {
  const times = session.moveTimes;
  if (times.length < MIN_MOVES_TO_ANALYSE) return;

  const reasons = [];

  const instantCount = times.filter((t) => t < MIN_HUMAN_MOVE_MS).length;
  if (instantCount / times.length > INSTANT_MOVE_RATIO) {
    reasons.push(
      `${Math.round((instantCount / times.length) * 100)}% of moves under ${MIN_HUMAN_MOVE_MS} ms`,
    );
  }

  if (times.length >= 10 && stddev(times) < LOW_VARIANCE_STDDEV) {
    reasons.push(
      `move-time stddev ${Math.round(stddev(times))} ms is abnormally low`,
    );
  }

  if (mean(times) < MIN_HUMAN_MOVE_MS * 1.5) {
    reasons.push(
      `mean move time ${Math.round(mean(times))} ms is below human threshold`,
    );
  }

  if (reasons.length > 0) {
    session.flagged = true;
    session.reasons = reasons;
  }
}

/**
 * Return the current anti-cheat status for a player.
 *
 * @param {string} gameCode
 * @param {'white'|'black'} color
 * @returns {{ flagged: boolean, reasons: string[], moveCount: number, meanMoveMs: number|null }}
 */
function getStatus(gameCode, color) {
  const session = getSession(gameCode, color);
  const times = session.moveTimes;
  return {
    flagged: session.flagged,
    reasons: session.reasons,
    moveCount: times.length,
    meanMoveMs: times.length ? Math.round(mean(times)) : null,
  };
}

/**
 * Clean up session data when a game ends to prevent unbounded memory growth.
 *
 * @param {string} gameCode
 */
function clearGame(gameCode) {
  sessions.delete(gameCode);
}

module.exports = { recordMove, getStatus, clearGame };
