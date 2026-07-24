import { authenticateRequest } from '../../src/auth.js';
import { catchTokensEqual, deriveCatchToken, isCatchTokenFormatValid } from '../../src/catch-token.js';
import { loadConfig } from '../../src/config.js';
import { HttpError } from '../../src/errors.js';
import { getDatabase } from '../../src/firebase-admin.js';
import { effectivePhase, finalizeLobby, reconcileLobby } from '../../src/game-repository.js';
import { createApiHandler } from '../../src/http.js';
import { commitLobby, rejectLobby, runLobbyTransaction } from '../../src/lobby-transaction.js';
import { success } from '../../src/responses.js';
import { assertOnlyFields, normalizeLobbyCode } from '../../src/validation.js';

interface CatchOutcome { error?: HttpError }

export default createApiHandler(async (req, res) => {
  const uid = await authenticateRequest(req);
  assertOnlyFields(req.body, ['lobbyCode', 'scannedToken']);
  const lobbyCode = normalizeLobbyCode(String(req.body.lobbyCode ?? ''));
  const scannedToken = String(req.body.scannedToken ?? '');
  if (!lobbyCode) throw new HttpError(400, 'INVALID_INPUT', 'Invalid lobbyCode');
  if (!isCatchTokenFormatValid(scannedToken)) throw new HttpError(409, 'INVALID_CATCH_TOKEN', 'Invalid catch token');
  const secret = loadConfig().catchTokenSecret;
  const now = Date.now();

  const outcome = await runLobbyTransaction<CatchOutcome>(getDatabase().ref(`lobbies/${lobbyCode}`), (current) => {
    if (!current) return rejectLobby(404, 'LOBBY_NOT_FOUND', 'Lobby not found');
    const player = current.players?.[uid];
    if (!player || player.eliminated) return rejectLobby(403, 'NOT_ACTIVE_MEMBER', 'Active lobby membership required');
    if (player.role !== 'hunter') return rejectLobby(403, 'NOT_HUNTER', 'Only an active hunter can catch the agent');

    const reconciled = reconcileLobby({
      ...current,
      players: { ...current.players, [uid]: { ...player, lastSeenAt: now, disconnectedAt: null } },
      lastActivityAt: now
    }, now);
    if (reconciled.result || reconciled.gameState === 'ended') {
      return commitLobby(reconciled, { error: new HttpError(409, 'GAME_ALREADY_ENDED', 'Game already ended') });
    }
    if (effectivePhase(reconciled, now) !== 'playing') {
      return commitLobby(reconciled, { error: new HttpError(409, 'INVALID_GAME_PHASE', 'Catch is only available while playing') });
    }
    if (reconciled.gameStartedAt == null) {
      return commitLobby(reconciled, { error: new HttpError(409, 'INVALID_STATE', 'Game has no start time') });
    }
    const agent = Object.values(reconciled.players).find((candidate) => candidate.role === 'agent' && !candidate.eliminated);
    if (!agent) return commitLobby(reconciled, { error: new HttpError(409, 'INVALID_AGENT_COUNT', 'Active agent not found') });
    const expectedToken = deriveCatchToken(secret, lobbyCode, reconciled.gameStartedAt, agent.uid);
    if (!catchTokensEqual(scannedToken, expectedToken)) {
      return commitLobby(reconciled, { error: new HttpError(409, 'INVALID_CATCH_TOKEN', 'Invalid catch token') });
    }

    return commitLobby(finalizeLobby(reconciled, now, 'hunters', 'caught', uid), {});
  });

  if (outcome.error) throw outcome.error;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(success({ caught: true })));
}, { methods: ['POST'] });
