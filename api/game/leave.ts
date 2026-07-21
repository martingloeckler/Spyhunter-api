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

    if (!player) {
      return current;
    }

    if (phase === 'lobby') {
      const nextPlayers = { ...(lobby.players ?? {}) };
      delete nextPlayers[uid];
      if (Object.keys(nextPlayers).length === 0) {
        return null;
      }
      return { ...lobby, players: nextPlayers, lastActivityAt: now };
    }

    if (!player.eliminated) {
      if (player.role === 'agent') {
        return {
          ...lobby,
          gameState: 'ended',
          result: {
            winner: 'none',
            reason: 'agent_left',
            finalizedAt: now
          },
          lastActivityAt: now
        };
      }

      const nextPlayers = { ...(lobby.players ?? {}) };
      nextPlayers[uid] = { ...player, eliminated: true, eliminatedReason: 'voluntary' };
      const activePlayers = Object.values(nextPlayers).filter((candidate: any) => !candidate.eliminated);
      if (activePlayers.length < 2) {
        return {
          ...lobby,
          players: nextPlayers,
          gameState: 'ended',
          result: {
            winner: 'none',
            reason: 'too_few_players',
            finalizedAt: now
          },
          lastActivityAt: now
        };
      }
      return { ...lobby, players: nextPlayers, lastActivityAt: now };
    }

    return current;
  });

  if (!result.committed) {
    throw new HttpError(409, 'INVALID_STATE', 'Leave action could not be completed');
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(success({ ok: true })));
});
