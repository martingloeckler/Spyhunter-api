import { authenticateRequest } from '../../src/auth.js';
import { HttpError } from '../../src/errors.js';
import { getDatabase } from '../../src/firebase-admin.js';
import { createApiHandler } from '../../src/http.js';
import { createLobbyView } from '../../src/lobby-view.js';
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
  if (!lobby.players?.[uid]) throw new HttpError(403, 'NOT_LOBBY_MEMBER', 'Lobby membership required');

  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, private'
  });
  res.end(JSON.stringify(success({ lobby: createLobbyView(lobby, uid) })));
}, { methods: ['POST'] });
