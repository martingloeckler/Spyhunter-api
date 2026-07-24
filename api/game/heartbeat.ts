import { authenticateRequest } from '../../src/auth.js';
import { HttpError } from '../../src/errors.js';
import { getDatabase } from '../../src/firebase-admin.js';
import { reconcileLobby } from '../../src/game-repository.js';
import { createApiHandler } from '../../src/http.js';
import { commitLobby, rejectLobby, runLobbyTransaction } from '../../src/lobby-transaction.js';
import { success } from '../../src/responses.js';
import { assertOnlyFields, normalizeLobbyCode } from '../../src/validation.js';

export default createApiHandler(async (req, res) => {
  const uid = await authenticateRequest(req);
  assertOnlyFields(req.body, ['lobbyCode']);
  const lobbyCode = normalizeLobbyCode(String(req.body.lobbyCode ?? ''));
  if (!lobbyCode) throw new HttpError(400, 'INVALID_INPUT', 'Invalid lobbyCode');
  const now = Date.now();

  const data = await runLobbyTransaction(getDatabase().ref(`lobbies/${lobbyCode}`), (lobby) => {
    if (!lobby) return rejectLobby(404, 'LOBBY_NOT_FOUND', 'Lobby not found');
    const player = lobby.players?.[uid];
    if (!player) return rejectLobby(403, 'NOT_LOBBY_MEMBER', 'Lobby membership required');
    const updated = reconcileLobby({
      ...lobby,
      players: {
        ...lobby.players,
        [uid]: { ...player, lastSeenAt: now, disconnectedAt: null }
      },
      lastActivityAt: now
    }, now);
    return commitLobby(updated, { gameState: updated.gameState, result: updated.result ?? null });
  });

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(success(data)));
}, { methods: ['POST'] });
