import { authenticateRequest } from '../../src/auth.js';
import { HttpError } from '../../src/errors.js';
import { getDatabase } from '../../src/firebase-admin.js';
import { countAgents, resetPlayerForStart, validateLobbySettings, validatePlayerCount } from '../../src/game-repository.js';
import { createApiHandler } from '../../src/http.js';
import { commitLobby, rejectLobby, runLobbyTransaction } from '../../src/lobby-transaction.js';
import { success } from '../../src/responses.js';
import type { Lobby } from '../../src/types.js';
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
    if (!player || player.eliminated) return rejectLobby(403, 'NOT_LOBBY_MEMBER', 'Lobby membership required');
    if (lobby.hostUid !== uid) return rejectLobby(403, 'HOST_REQUIRED', 'Only the host can start the game');
    if (lobby.gameState !== 'lobby') return rejectLobby(409, 'GAME_ALREADY_STARTED', 'Game already started');
    if (!validatePlayerCount(lobby.players)) return rejectLobby(409, 'INVALID_PLAYER_COUNT', 'Player count must be between two and six');
    if (countAgents(lobby.players) !== 1) return rejectLobby(409, 'INVALID_AGENT_COUNT', 'Exactly one agent is required');
    if (!validateLobbySettings(lobby)) return rejectLobby(409, 'INVALID_LOBBY_SETTINGS', 'Lobby settings or game field are invalid');

    const agentUid = Object.values(lobby.players).find((candidate) => candidate.role === 'agent' && !candidate.eliminated)!.uid;
    const players = Object.fromEntries(Object.entries(lobby.players).map(([playerUid, candidate]) => [
      playerUid,
      resetPlayerForStart(candidate, playerUid === agentUid ? 'agent' : 'hunter', now)
    ]));
    const updated = {
      ...lobby,
      gameState: 'countdown' as const,
      gameStartedAt: now,
      players,
      lastActivityAt: now,
      agentInterceptUsed: false
    } as Lobby & { agentBleUuid?: unknown };
    delete updated.agentBleUuid;
    delete updated.result;
    delete updated.agentPulseMarker;
    return commitLobby(updated, { gameStartedAt: now });
  });

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(success(data)));
}, { methods: ['POST'] });
