import { createApiHandler } from '../../src/http.js';
import { getDatabase } from '../../src/firebase-admin.js';
import { authenticateRequest } from '../../src/auth.js';
import { HttpError } from '../../src/errors.js';
import { success } from '../../src/responses.js';
import { normalizeLobbyCode } from '../../src/validation.js';
import { effectivePhase } from '../../src/game-repository.js';
import { loadConfig } from '../../src/config.js';

export default createApiHandler(async (req, res) => {
  const config = loadConfig();
  const uid = await authenticateRequest(req, config.cronSecret);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const lobbyCode = normalizeLobbyCode(String(body.lobbyCode ?? ''));

  if (!lobbyCode) {
    throw new HttpError(400, 'INVALID_INPUT', 'Invalid lobbyCode');
  }

  const db = getDatabase();
  const result = await db.ref(`lobbies/${lobbyCode}`).transaction((current: any) => {
    if (!current) {
      return undefined;
    }

    const lobby = current as any;
    const player = (lobby.players ?? {})[uid];
    const now = Date.now();
    const phase = effectivePhase(lobby, now);

    if (!player || player.eliminated || player.role !== 'agent') {
      return current;
    }
    if (phase !== 'playing') {
      return current;
    }
    if (lobby.settings?.agentInterceptEnabled !== true) {
      return current;
    }
    if (lobby.agentInterceptUsed === true) {
      return current;
    }

    return {
      ...lobby,
      agentInterceptUsed: true,
      lastActivityAt: now
    };
  });

  if (!result.committed) {
    throw new HttpError(409, 'INTERCEPT_ALREADY_USED', 'Intercept already used or invalid state');
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(success({ ok: true })));
});
