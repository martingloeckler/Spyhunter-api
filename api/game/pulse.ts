import { createApiHandler } from '../../src/http.js';
import { getDatabase } from '../../src/firebase-admin.js';
import { authenticateRequest } from '../../src/auth.js';
import { HttpError } from '../../src/errors.js';
import { success } from '../../src/responses.js';
import { normalizeLobbyCode } from '../../src/validation.js';
import { effectivePhase, canAgentPulse } from '../../src/game-repository.js';
import { loadConfig, PULSE_FRESHNESS_WINDOW_MS } from '../../src/config.js';

export default createApiHandler(async (req, res) => {
  const config = loadConfig();
  const uid = await authenticateRequest(req, config.cronSecret);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const lobbyCode = normalizeLobbyCode(String(body.lobbyCode ?? ''));
  const pulseIndex = Number(body.pulseIndex ?? 0);

  if (!lobbyCode || !Number.isInteger(pulseIndex) || pulseIndex < 1 || pulseIndex > 30) {
    throw new HttpError(400, 'INVALID_INPUT', 'Invalid pulseIndex');
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

    if (!canAgentPulse(player, now, pulseIndex, lobby.agentPulseMarker?.pulseIndex, lobby.settings?.pulseIntervalSec ?? 0)) {
      return current;
    }

    if (phase !== 'playing') {
      return current;
    }

    const expectedPulseTime = lobby.gameStartedAt + pulseIndex * lobby.settings.pulseIntervalSec * 1000;
    if (expectedPulseTime > now + PULSE_FRESHNESS_WINDOW_MS) {
      return current;
    }

    return {
      ...lobby,
      agentPulseMarker: {
        lat: player.lat,
        lng: player.lng,
        pulseIndex,
        timestamp: now
      },
      lastActivityAt: now
    };
  });

  if (!result.committed) {
    throw new HttpError(409, 'INVALID_STATE', 'Pulse could not be accepted');
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(success({ ok: true })));
});
