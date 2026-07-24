import { authenticateRequest } from '../../src/auth.js';
import { MAX_PLAYERS } from '../../src/config.js';
import { HttpError } from '../../src/errors.js';
import { getDatabase } from '../../src/firebase-admin.js';
import { createPlayer } from '../../src/game-repository.js';
import { createApiHandler } from '../../src/http.js';
import { commitLobby, rejectLobby, runLobbyTransaction } from '../../src/lobby-transaction.js';
import { success } from '../../src/responses.js';
import { assertOnlyFields, normalizeLobbyCode, normalizeNickname, normalizePlayerColor } from '../../src/validation.js';

export default createApiHandler(async (req, res) => {
  const uid = await authenticateRequest(req);
  assertOnlyFields(req.body, ['lobbyCode', 'player']);
  assertOnlyFields(req.body.player, ['nickname', 'color'], 'player');
  const lobbyCode = normalizeLobbyCode(String(req.body.lobbyCode ?? ''));
  const nickname = normalizeNickname(String(req.body.player.nickname ?? ''));
  const color = normalizePlayerColor(String(req.body.player.color ?? ''));
  if (!lobbyCode || !nickname || !color) throw new HttpError(400, 'INVALID_INPUT', 'Invalid join data');

  const now = Date.now();
  const data = await runLobbyTransaction(getDatabase().ref(`lobbies/${lobbyCode}`), (lobby) => {
    if (!lobby) return rejectLobby(404, 'LOBBY_NOT_FOUND', 'Lobby not found');
    if (lobby.gameState !== 'lobby') return rejectLobby(409, 'GAME_ALREADY_STARTED', 'Game already started');
    const existing = lobby.players?.[uid];
    if (existing) return commitLobby(lobby, { player: existing, idempotent: true });

    const players = Object.values(lobby.players ?? {});
    if (players.length >= MAX_PLAYERS) return rejectLobby(409, 'LOBBY_FULL', 'Lobby is full');
    if (players.some((player) => player.nickname.toLocaleLowerCase() === nickname.toLocaleLowerCase())) {
      return rejectLobby(409, 'NICKNAME_TAKEN', 'Nickname is already in use');
    }
    if (players.some((player) => player.color.toUpperCase() === color)) {
      return rejectLobby(409, 'COLOR_TAKEN', 'Color is already in use');
    }

    const player = createPlayer(uid, nickname, color, now);
    return commitLobby({
      ...lobby,
      players: { ...(lobby.players ?? {}), [uid]: player },
      lastActivityAt: now
    }, { player, idempotent: false });
  });

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(success(data)));
}, { methods: ['POST'] });
