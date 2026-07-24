import { authenticateRequest } from '../../src/auth.js';
import { MAX_PULSE_INDEX } from '../../src/config.js';
import { HttpError } from '../../src/errors.js';
import { getDatabase } from '../../src/firebase-admin.js';
import { canAgentPulse, effectivePhase, reconcileLobby } from '../../src/game-repository.js';
import { createApiHandler } from '../../src/http.js';
import { commitLobby, rejectLobby, runLobbyTransaction } from '../../src/lobby-transaction.js';
import { success } from '../../src/responses.js';
import { assertOnlyFields, normalizeLobbyCode } from '../../src/validation.js';

interface PulseOutcome { error?: HttpError }

export default createApiHandler(async (req, res) => {
  const uid = await authenticateRequest(req);
  assertOnlyFields(req.body, ['lobbyCode', 'pulseIndex']);
  const lobbyCode = normalizeLobbyCode(String(req.body.lobbyCode ?? ''));
  const pulseIndex = Number(req.body.pulseIndex);
  if (!lobbyCode || !Number.isInteger(pulseIndex) || pulseIndex < 1 || pulseIndex > MAX_PULSE_INDEX) {
    throw new HttpError(400, 'INVALID_INPUT', 'Invalid pulseIndex');
  }
  const now = Date.now();

  const outcome = await runLobbyTransaction<PulseOutcome>(getDatabase().ref(`lobbies/${lobbyCode}`), (current) => {
    if (!current) return rejectLobby(404, 'LOBBY_NOT_FOUND', 'Lobby not found');
    const player = current.players?.[uid];
    if (!player || player.eliminated || player.role !== 'agent') return rejectLobby(403, 'NOT_AGENT', 'Only the active agent can publish a pulse');
    const withHeartbeat = {
      ...current,
      players: { ...current.players, [uid]: { ...player, lastSeenAt: now, disconnectedAt: null } },
      lastActivityAt: now
    };
    const reconciled = reconcileLobby(withHeartbeat, now);
    if (reconciled.result || reconciled.gameState === 'ended') {
      return commitLobby(reconciled, { error: new HttpError(409, 'GAME_ALREADY_ENDED', 'Game already ended') });
    }
    if (effectivePhase(reconciled, now) !== 'playing') {
      return commitLobby(reconciled, { error: new HttpError(409, 'INVALID_GAME_PHASE', 'Pulse is only available while playing') });
    }
    const currentAgent = reconciled.players[uid];
    if (!canAgentPulse(currentAgent, now, pulseIndex, reconciled.agentPulseMarker?.pulseIndex, reconciled.settings.pulseIntervalSec)) {
      return commitLobby(reconciled, { error: new HttpError(409, 'INVALID_PULSE', 'Pulse index or agent position is invalid') });
    }
    const expectedPulseIndex = Math.floor((now - (reconciled.gameStartedAt ?? now)) / (reconciled.settings.pulseIntervalSec * 1000));
    if (pulseIndex > expectedPulseIndex) {
      return commitLobby(reconciled, { error: new HttpError(409, 'PULSE_NOT_DUE', 'Pulse is not due yet') });
    }

    const updated = reconcileLobby({
      ...reconciled,
      agentPulseMarker: {
        lat: currentAgent.lat!,
        lng: currentAgent.lng!,
        pulseIndex,
        timestamp: now
      },
      lastActivityAt: now
    }, now);
    return commitLobby(updated, {});
  });

  if (outcome.error) throw outcome.error;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(success({ pulseIndex })));
}, { methods: ['POST'] });
