import { authenticateRequest } from '../../src/auth.js';
import { MAX_POSITION_SPEED_MPS, POSITION_MIN_INTERVAL_MS } from '../../src/config.js';
import { HttpError } from '../../src/errors.js';
import { getDatabase } from '../../src/firebase-admin.js';
import { applyPositionRules, effectivePhase, haversineMeters, reconcileLobby } from '../../src/game-repository.js';
import { createApiHandler } from '../../src/http.js';
import { commitLobby, rejectLobby, runLobbyTransaction } from '../../src/lobby-transaction.js';
import { success } from '../../src/responses.js';
import type { Player } from '../../src/types.js';
import { assertOnlyFields, isValidPosition, isValidUuid, normalizeLobbyCode } from '../../src/validation.js';

interface PositionOutcome {
  accepted: boolean;
  idempotent: boolean;
  error?: HttpError;
}

export default createApiHandler(async (req, res) => {
  const uid = await authenticateRequest(req);
  assertOnlyFields(req.body, ['lobbyCode', 'lat', 'lng', 'accuracy', 'sessionId', 'sequence']);
  const lobbyCode = normalizeLobbyCode(String(req.body.lobbyCode ?? ''));
  const lat = Number(req.body.lat);
  const lng = Number(req.body.lng);
  const accuracy = Number(req.body.accuracy);
  const sessionId = String(req.body.sessionId ?? '');
  const sequence = Number(req.body.sequence);
  if (!lobbyCode || !isValidPosition(lat, lng, accuracy) || !isValidUuid(sessionId)
    || !Number.isSafeInteger(sequence) || sequence < 0) {
    throw new HttpError(400, 'INVALID_INPUT', 'Invalid position data');
  }

  const now = Date.now();
  const outcome = await runLobbyTransaction<PositionOutcome>(getDatabase().ref(`lobbies/${lobbyCode}`), (current) => {
    if (!current) return rejectLobby(404, 'LOBBY_NOT_FOUND', 'Lobby not found');
    const currentPlayer = current.players?.[uid];
    if (!currentPlayer || currentPlayer.eliminated) return rejectLobby(403, 'NOT_ACTIVE_MEMBER', 'Active lobby membership required');
    if (currentPlayer.positionSessionId !== sessionId) {
      return rejectLobby(409, 'POSITION_SESSION_EXPIRED', 'Position session is no longer active');
    }

    const withHeartbeat = {
      ...current,
      players: {
        ...current.players,
        [uid]: { ...currentPlayer, lastSeenAt: now, disconnectedAt: null }
      },
      lastActivityAt: now
    };
    const reconciled = reconcileLobby(withHeartbeat, now);
    if (reconciled.result || reconciled.gameState === 'ended') {
      return commitLobby(reconciled, {
        accepted: false,
        idempotent: false,
        error: new HttpError(409, 'GAME_ALREADY_ENDED', 'Game already ended')
      });
    }
    const phase = effectivePhase(reconciled, now);
    if (phase !== 'countdown' && phase !== 'playing') {
      return commitLobby(reconciled, {
        accepted: false,
        idempotent: false,
        error: new HttpError(409, 'INVALID_GAME_PHASE', 'Position is unavailable in this game phase')
      });
    }

    const player = reconciled.players[uid];
    if (sequence <= (player.positionSequence ?? -1)) {
      return commitLobby(reconciled, { accepted: false, idempotent: true });
    }
    if (player.positionUpdatedAt != null && now - player.positionUpdatedAt < POSITION_MIN_INTERVAL_MS) {
      return commitLobby(reconciled, {
        accepted: false,
        idempotent: false,
        error: new HttpError(429, 'POSITION_RATE_LIMITED', 'Position updates are too frequent')
      });
    }
    if (player.lat != null && player.lng != null && player.positionUpdatedAt != null) {
      const elapsedSeconds = (now - player.positionUpdatedAt) / 1000;
      const measuredDistance = haversineMeters(player.lat, player.lng, lat, lng);
      const plausibleDistance = Math.max(0, measuredDistance - (player.accuracy ?? 0) - accuracy);
      if (elapsedSeconds > 0 && plausibleDistance / elapsedSeconds > MAX_POSITION_SPEED_MPS) {
        return commitLobby(reconciled, {
          accepted: false,
          idempotent: false,
          error: new HttpError(409, 'IMPLAUSIBLE_POSITION', 'Position change exceeds the speed limit')
        });
      }
    }

    let updatedPlayer: Player = {
      ...player,
      lat,
      lng,
      accuracy,
      positionUpdatedAt: now,
      lastSeenAt: now,
      disconnectedAt: null,
      positionSequence: sequence
    };
    updatedPlayer = applyPositionRules(updatedPlayer, reconciled, lat, lng, accuracy, now);
    const updated = reconcileLobby({
      ...reconciled,
      players: { ...reconciled.players, [uid]: updatedPlayer },
      lastActivityAt: now
    }, now);
    return commitLobby(updated, { accepted: true, idempotent: false });
  });

  if (outcome.error) throw outcome.error;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(success({ accepted: outcome.accepted, idempotent: outcome.idempotent })));
}, { methods: ['POST'] });
