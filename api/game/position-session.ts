import crypto from 'node:crypto';
import { authenticateRequest } from '../../src/auth.js';
import { HttpError } from '../../src/errors.js';
import { getDatabase } from '../../src/firebase-admin.js';
import { createApiHandler } from '../../src/http.js';
import { commitLobby, rejectLobby, runLobbyTransaction } from '../../src/lobby-transaction.js';
import { success } from '../../src/responses.js';
import { assertOnlyFields, normalizeLobbyCode } from '../../src/validation.js';

export default createApiHandler(async (req, res) => {
  const uid = await authenticateRequest(req);
  assertOnlyFields(req.body, ['lobbyCode']);
  const lobbyCode = normalizeLobbyCode(String(req.body.lobbyCode ?? ''));
  if (!lobbyCode) throw new HttpError(400, 'INVALID_INPUT', 'Invalid lobbyCode');

  // Generate once outside the transaction so Firebase retries keep the same outcome.
  const sessionId = crypto.randomUUID();
  const now = Date.now();
  await runLobbyTransaction(getDatabase().ref(`lobbies/${lobbyCode}`), (lobby) => {
    if (!lobby) return rejectLobby(404, 'LOBBY_NOT_FOUND', 'Lobby not found');
    const player = lobby.players?.[uid];
    if (!player || player.eliminated) {
      return rejectLobby(403, 'NOT_ACTIVE_MEMBER', 'Active lobby membership required');
    }

    return commitLobby({
      ...lobby,
      players: {
        ...lobby.players,
        [uid]: {
          ...player,
          positionSessionId: sessionId,
          positionSequence: -1,
          lastSeenAt: now,
          disconnectedAt: null
        }
      },
      lastActivityAt: now
    }, undefined);
  });

  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, private'
  });
  res.end(JSON.stringify(success({ sessionId })));
}, { methods: ['POST'] });
