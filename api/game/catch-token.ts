import { authenticateRequest } from '../../src/auth.js';
import { deriveCatchToken } from '../../src/catch-token.js';
import { loadConfig } from '../../src/config.js';
import { HttpError } from '../../src/errors.js';
import { getDatabase } from '../../src/firebase-admin.js';
import { effectivePhase } from '../../src/game-repository.js';
import { createApiHandler } from '../../src/http.js';
import { success } from '../../src/responses.js';
import type { Lobby } from '../../src/types.js';
import { assertOnlyFields, normalizeLobbyCode } from '../../src/validation.js';

export default createApiHandler(async (req, res) => {
  const uid = await authenticateRequest(req);
  assertOnlyFields(req.body, ['lobbyCode']);
  const lobbyCode = normalizeLobbyCode(String(req.body.lobbyCode ?? ''));
  if (!lobbyCode) throw new HttpError(400, 'INVALID_INPUT', 'Invalid lobbyCode');

  const snapshot = await getDatabase().ref(`lobbies/${lobbyCode}`).once('value');
  const lobby = snapshot.val() as Lobby | null;
  if (!lobby) throw new HttpError(404, 'LOBBY_NOT_FOUND', 'Lobby not found');
  const player = lobby.players?.[uid];
  if (!player || player.eliminated || player.role !== 'agent') {
    throw new HttpError(403, 'NOT_AGENT', 'Only the active agent can request the catch token');
  }
  const phase = effectivePhase(lobby, Date.now());
  if (phase !== 'countdown' && phase !== 'playing') {
    throw new HttpError(409, 'INVALID_GAME_PHASE', 'Catch token is unavailable in this game phase');
  }
  if (lobby.gameStartedAt == null) throw new HttpError(409, 'INVALID_STATE', 'Game has no start time');

  const token = deriveCatchToken(loadConfig().catchTokenSecret, lobbyCode, lobby.gameStartedAt, uid);
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(success({ token })));
}, { methods: ['POST'] });
