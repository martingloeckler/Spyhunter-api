import { createApiHandler } from '../../src/http.js';
import { getDatabase } from '../../src/firebase-admin.js';
import { authenticateRequest } from '../../src/auth.js';
import { HttpError } from '../../src/errors.js';
import { failure, success } from '../../src/responses.js';
import { normalizeLobbyCode } from '../../src/validation.js';
import { countAgents, effectivePhase, validateLobbySettings, validatePlayerCount } from '../../src/game-repository.js';
import { loadConfig } from '../../src/config.js';
import crypto from 'node:crypto';

export default createApiHandler(async (req, res) => {
  const config = loadConfig();
  const uid = await authenticateRequest(req, config.cronSecret);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const lobbyCode = normalizeLobbyCode(String(body.lobbyCode ?? ''));

  if (!lobbyCode) {
    throw new HttpError(400, 'INVALID_INPUT', 'Invalid lobbyCode');
  }

  const db = getDatabase();
  const lobbyRef = db.ref(`lobbies/${lobbyCode}`);
  const result = await db.ref(`lobbies/${lobbyCode}`).transaction((current: any) => {
    if (!current) {
      return undefined;
    }

    const lobby = current as any;
    const players = Object.values(lobby.players ?? {}) as Array<any>;
    const activePlayers = players.filter((player) => !player.eliminated);

    if (!activePlayers.some((player) => player.uid === uid)) {
      return undefined;
    }

    if (lobby.gameState !== 'lobby') {
      return undefined;
    }

    if (!validatePlayerCount(lobby.players ?? {})) {
      return undefined;
    }

    if (countAgents(lobby.players ?? {}) !== 1) {
      return undefined;
    }

    if (!validateLobbySettings(lobby)) {
      return undefined;
    }

    const serverNow = Date.now();
    const updated = {
      ...lobby,
      gameState: 'countdown',
      gameStartedAt: serverNow,
      agentBleUuid: crypto.randomUUID(),
      lastActivityAt: serverNow,
      result: undefined,
      agentPulseMarker: undefined,
      agentInterceptUsed: false
    } as any;

    for (const player of Object.values(updated.players ?? {}) as Array<any>) {
      if (player.role !== 'agent') {
        player.role = 'hunter';
      }
    }

    return updated;
  });

  if (!result.committed || !result.snapshot?.val()) {
    throw new HttpError(409, 'GAME_ALREADY_STARTED', 'Game already started or invalid state');
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(success({ ok: true })));
});
