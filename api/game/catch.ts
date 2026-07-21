import { createApiHandler } from '../../src/http.js';
import { getDatabase } from '../../src/firebase-admin.js';
import { authenticateRequest } from '../../src/auth.js';
import { HttpError } from '../../src/errors.js';
import { success } from '../../src/responses.js';
import { normalizeLobbyCode, isValidUuid } from '../../src/validation.js';
import { effectivePhase } from '../../src/game-repository.js';
import { loadConfig } from '../../src/config.js';

export default createApiHandler(async (req, res) => {
  const config = loadConfig();
  const uid = await authenticateRequest(req, config.cronSecret);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const lobbyCode = normalizeLobbyCode(String(body.lobbyCode ?? ''));
  const scannedToken = String(body.scannedToken ?? '');

  if (!lobbyCode || !isValidUuid(scannedToken)) {
    throw new HttpError(400, 'INVALID_INPUT', 'Invalid input');
  }

  const db = getDatabase();
  const lobbyRef = db.ref(`lobbies/${lobbyCode}`);
  const result = await lobbyRef.transaction((current: any) => {
    if (!current) {
      return undefined;
    }

    const lobby = current as any;
    const player = (lobby.players ?? {})[uid];
    if (!player || player.eliminated || player.role !== 'hunter') {
      return undefined;
    }

    const now = Date.now();
    const phase = effectivePhase(lobby, now);
    if (phase !== 'playing') {
      return undefined;
    }

    if (lobby.result || lobby.gameState === 'ended') {
      return current;
    }

    if (lobby.agentBleUuid !== scannedToken) {
      return current;
    }

    return {
      ...lobby,
      gameState: 'ended',
      result: {
        winner: 'hunters',
        reason: 'caught',
        caughtByUid: uid,
        finalizedAt: now
      },
      lastActivityAt: now
    };
  });

  if (!result.committed) {
    throw new HttpError(409, 'INVALID_STATE', 'Catch action could not be completed');
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(success({ ok: true })));
});
