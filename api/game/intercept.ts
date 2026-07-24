import { authenticateRequest } from '../../src/auth.js';
import { HttpError } from '../../src/errors.js';
import { getDatabase } from '../../src/firebase-admin.js';
import { effectivePhase, reconcileLobby } from '../../src/game-repository.js';
import { createApiHandler } from '../../src/http.js';
import { commitLobby, rejectLobby, runLobbyTransaction } from '../../src/lobby-transaction.js';
import { success } from '../../src/responses.js';
import { assertOnlyFields, normalizeLobbyCode } from '../../src/validation.js';

interface InterceptOutcome { error?: HttpError }

export default createApiHandler(async (req, res) => {
  const uid = await authenticateRequest(req);
  assertOnlyFields(req.body, ['lobbyCode']);
  const lobbyCode = normalizeLobbyCode(String(req.body.lobbyCode ?? ''));
  if (!lobbyCode) throw new HttpError(400, 'INVALID_INPUT', 'Invalid lobbyCode');
  const now = Date.now();

  const outcome = await runLobbyTransaction<InterceptOutcome>(getDatabase().ref(`lobbies/${lobbyCode}`), (current) => {
    if (!current) return rejectLobby(404, 'LOBBY_NOT_FOUND', 'Lobby not found');
    const player = current.players?.[uid];
    if (!player || player.eliminated || player.role !== 'agent') return rejectLobby(403, 'NOT_AGENT', 'Only the active agent can use intercept');
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
      return commitLobby(reconciled, { error: new HttpError(409, 'INVALID_GAME_PHASE', 'Intercept is only available while playing') });
    }
    if (reconciled.settings.agentInterceptEnabled !== true) {
      return commitLobby(reconciled, { error: new HttpError(409, 'INTERCEPT_DISABLED', 'Intercept is disabled') });
    }
    if (reconciled.agentInterceptUsed === true) {
      return commitLobby(reconciled, { error: new HttpError(409, 'INTERCEPT_ALREADY_USED', 'Intercept already used') });
    }
    return commitLobby({ ...reconciled, agentInterceptUsed: true, lastActivityAt: now }, {});
  });

  if (outcome.error) throw outcome.error;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(success({ activated: true })));
}, { methods: ['POST'] });
