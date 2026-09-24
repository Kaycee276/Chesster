function broadcastTournamentEvent(io, tournamentId, eventName, payload) {
  io.to(`tournament:${tournamentId}`).emit(eventName, {
    tournamentId,
    timestamp: new Date().toISOString(),
    ...payload,
  });
}

function emitPlayerJoined(io, tournamentId, payload) {
  broadcastTournamentEvent(io, tournamentId, "tournament:player_joined", payload);
}

function emitBracketGenerated(io, tournamentId, payload) {
  broadcastTournamentEvent(io, tournamentId, "tournament:bracket_generated", payload);
}

function emitMatchReady(io, tournamentId, payload) {
  broadcastTournamentEvent(io, tournamentId, "tournament:match_ready", payload);
}

function emitMatchCompleted(io, tournamentId, payload) {
  broadcastTournamentEvent(io, tournamentId, "tournament:match_completed", payload);
}

function emitTournamentCompleted(io, tournamentId, payload) {
  broadcastTournamentEvent(io, tournamentId, "tournament:completed", payload);
}

module.exports = {
  broadcastTournamentEvent,
  emitPlayerJoined,
  emitBracketGenerated,
  emitMatchReady,
  emitMatchCompleted,
  emitTournamentCompleted,
};
