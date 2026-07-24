import { authenticateRequest } from '../../src/auth.js';
import { getDatabase } from '../../src/firebase-admin.js';
import { createPlayer } from '../../src/game-repository.js';
import { commitLobby, rejectLobby, runLobbyTransaction } from '../../src/lobby-transaction.js';
import { createApiHandler } from '../../src/http.js';
import { success } from '../../src/responses.js';
import type { Lobby } from '../../src/types.js';
import {
  assertOnlyFields,
  isValidGameField,
  isValidGameSettings,
  normalizeLobbyCode,
  normalizeNickname,
  normalizePlayerColor
} from '../../src/validation.js';
import { HttpError } from '../../src/errors.js';

export default createApiHandler(async (req, res) => {
  const uid = await authenticateRequest(req);
  assertOnlyFields(req.body, ['lobbyCode', 'gameField', 'settings', 'player']);
  const lobbyCode = normalizeLobbyCode(String(req.body.lobbyCode ?? ''));
  const gameField = req.body.gameField;
  const settings = req.body.settings;
  const playerInput = req.body.player;

  assertOnlyFields(gameField, ['north', 'south', 'east', 'west'], 'gameField');
  assertOnlyFields(settings, ['gameDurationSec', 'countdownDurationSec', 'pulseIntervalSec', 'agentInterceptEnabled'], 'settings');
  assertOnlyFields(playerInput, ['nickname', 'color'], 'player');
  const nickname = normalizeNickname(String(playerInput.nickname ?? ''));
  const color = normalizePlayerColor(String(playerInput.color ?? ''));
  if (!lobbyCode || !isValidGameField(gameField) || !isValidGameSettings(settings) || !nickname || !color) {
    throw new HttpError(400, 'INVALID_INPUT', 'Invalid lobby data');
  }

  const now = Date.now();
  const lobby: Lobby = {
    hostUid: uid,
    createdAt: now,
    lastActivityAt: now,
    gameState: 'lobby',
    gameStartedAt: null,
    gameField,
    settings,
    players: { [uid]: createPlayer(uid, nickname, color, now) },
    agentInterceptUsed: false
  };

  const db = getDatabase();
  await runLobbyTransaction(db.ref(`lobbies/${lobbyCode}`), (current) => {
    if (current) return rejectLobby(409, 'LOBBY_ALREADY_EXISTS', 'Lobby already exists');
    return commitLobby(lobby, undefined);
  });

  res.writeHead(201, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(success({ lobbyCode, lobby })));
}, { methods: ['POST'] });
