import { authenticateRequest } from '../../src/auth.js';
import { HttpError } from '../../src/errors.js';
import { getDatabase } from '../../src/firebase-admin.js';
import { createApiHandler } from '../../src/http.js';
import { success } from '../../src/responses.js';
import type { Lobby } from '../../src/types.js';
import { assertOnlyFields, normalizeLobbyCode } from '../../src/validation.js';
import { MAX_PLAYERS } from '../../src/config.js';

export default createApiHandler(async (req, res) => {
  await authenticateRequest(req);
  assertOnlyFields(req.body, ['lobbyCode']);
  const lobbyCode = normalizeLobbyCode(String(req.body.lobbyCode ?? ''));
  if (!lobbyCode) throw new HttpError(400, 'INVALID_INPUT', 'Invalid lobbyCode');

  const snapshot = await getDatabase().ref(`lobbies/${lobbyCode}`).once('value');
  const lobby = snapshot.val() as Lobby | null;
  if (!lobby) throw new HttpError(404, 'LOBBY_NOT_FOUND', 'Lobby not found');
  if (lobby.gameState !== 'lobby') throw new HttpError(409, 'GAME_ALREADY_STARTED', 'Game already started');

  const players = Object.values(lobby.players ?? {});
  if (players.length >= MAX_PLAYERS) throw new HttpError(409, 'LOBBY_FULL', 'Lobby is full');
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(success({
    canJoin: true,
    occupiedColors: players.map((player) => player.color),
    playerCount: players.length
  })));
}, { methods: ['POST'] });
