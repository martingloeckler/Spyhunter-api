import { authenticateRequest } from '../../src/auth.js';
import { getDatabase } from '../../src/firebase-admin.js';
import { createApiHandler } from '../../src/http.js';
import { commitLobby, rejectLobby, runLobbyTransaction } from '../../src/lobby-transaction.js';
import { success } from '../../src/responses.js';
import { assertOnlyFields, normalizeLobbyCode } from '../../src/validation.js';
import { HttpError } from '../../src/errors.js';

export default createApiHandler(async (req, res) => {
  const uid = await authenticateRequest(req);
  assertOnlyFields(req.body, ['lobbyCode']);
  const lobbyCode = normalizeLobbyCode(String(req.body.lobbyCode ?? ''));
  if (!lobbyCode) throw new HttpError(400, 'INVALID_INPUT', 'Invalid lobbyCode');
  const now = Date.now();

  const data = await runLobbyTransaction(getDatabase().ref(`lobbies/${lobbyCode}`), (lobby) => {
    if (!lobby) return rejectLobby(404, 'LOBBY_NOT_FOUND', 'Lobby not found');
    if (lobby.gameState !== 'lobby') return rejectLobby(409, 'GAME_ALREADY_STARTED', 'Game already started');
    const player = lobby.players?.[uid];
    if (!player || player.eliminated) return rejectLobby(403, 'NOT_LOBBY_MEMBER', 'Lobby membership required');
    if (player.role === null) return commitLobby(lobby, { idempotent: true });
    if (player.role !== 'agent') return rejectLobby(403, 'NOT_AGENT', 'Only the current agent can release the role');
    return commitLobby({
      ...lobby,
      players: { ...lobby.players, [uid]: { ...player, role: null } },
      lastActivityAt: now
    }, { idempotent: false });
  });

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(success(data)));
}, { methods: ['POST'] });
