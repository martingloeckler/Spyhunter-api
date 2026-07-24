import {
  COUNTDOWN_POSITION_ACCURACY_METERS,
  DISCONNECT_ELIMINATION_MS,
  DISCONNECT_THRESHOLD_MS,
  HUNTER_START_RADIUS_METERS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PULSE_FRESHNESS_WINDOW_MS,
  PULSE_GRACE_MS,
  VIOLATION_TIMEOUT_MS
} from './config.js';
import type { GameResult, GameResultReason, GameState, Lobby, Player } from './types.js';
import { isValidGameField, isValidGameSettings } from './validation.js';

export function effectivePhase(lobby: Pick<Lobby, 'gameState' | 'gameStartedAt' | 'settings'>, now: number): GameState {
  if (lobby.gameState === 'ended') return 'ended';
  if (lobby.gameState === 'lobby' || lobby.gameStartedAt == null) return 'lobby';

  const elapsedSec = Math.floor((now - lobby.gameStartedAt) / 1000);
  if (elapsedSec < lobby.settings.countdownDurationSec) return 'countdown';
  if (elapsedSec < lobby.settings.gameDurationSec) return 'playing';
  return 'ended';
}

export function isPlayerActive(player: Player | undefined): player is Player {
  return !!player && !player.eliminated;
}

export function canAgentPulse(player: Player | undefined, now: number, pulseIndex: number, lastPulseIndex: number | undefined, _pulseIntervalSec: number): boolean {
  if (!player || player.eliminated || player.role !== 'agent') return false;
  if (player.lat == null || player.lng == null || player.positionUpdatedAt == null) return false;
  if (now - player.positionUpdatedAt > PULSE_FRESHNESS_WINDOW_MS) return false;
  if (pulseIndex <= (lastPulseIndex ?? 0)) return false;
  return Number.isInteger(pulseIndex) && pulseIndex >= 1 && pulseIndex <= 30;
}

export function validateLobbySettings(lobby: Pick<Lobby, 'settings' | 'gameField'>): boolean {
  return isValidGameSettings(lobby.settings) && isValidGameField(lobby.gameField);
}

export function validatePlayerCount(players: Record<string, Player>): boolean {
  const activeCount = Object.values(players).filter((player) => !player.eliminated).length;
  return activeCount >= MIN_PLAYERS && activeCount <= MAX_PLAYERS;
}

export function countAgents(players: Record<string, Player>): number {
  return Object.values(players).filter((player) => player.role === 'agent' && !player.eliminated).length;
}

export function createPlayer(uid: string, nickname: string, color: string, now: number): Player {
  return {
    uid,
    nickname,
    color,
    role: null,
    joinedAt: now,
    lat: null,
    lng: null,
    accuracy: null,
    positionUpdatedAt: null,
    lastSeenAt: now,
    disconnectedAt: null,
    eliminated: false,
    eliminatedReason: null,
    countdownStartLat: null,
    countdownStartLng: null,
    countdownViolationStartedAt: null,
    countdownViolation: null,
    fieldViolationStartedAt: null,
    fieldViolationActive: null
  };
}

export function resetPlayerForStart(player: Player, role: 'agent' | 'hunter', now: number): Player {
  const { positionSessionId: _positionSessionId, positionSequence: _positionSequence, ...basePlayer } = player;
  return {
    ...basePlayer,
    role,
    lastSeenAt: now,
    disconnectedAt: null,
    eliminated: false,
    eliminatedReason: null,
    countdownStartLat: null,
    countdownStartLng: null,
    countdownViolationStartedAt: null,
    countdownViolation: null,
    fieldViolationStartedAt: null,
    fieldViolationActive: null
  };
}

export function applyPositionRules(player: Player, lobby: Lobby, lat: number, lng: number, accuracy: number, now: number): Player {
  const next = { ...player };
  const phase = effectivePhase(lobby, now);

  const insideField = lat <= lobby.gameField.north && lat >= lobby.gameField.south
    && lng <= lobby.gameField.east && lng >= lobby.gameField.west;
  if (insideField) {
    next.fieldViolationStartedAt = null;
    next.fieldViolationActive = null;
  } else {
    next.fieldViolationStartedAt ??= now;
    next.fieldViolationActive = true;
  }

  if (phase === 'countdown' && player.role === 'hunter') {
    if (next.countdownStartLat == null || next.countdownStartLng == null) {
      if (accuracy <= COUNTDOWN_POSITION_ACCURACY_METERS) {
        next.countdownStartLat = lat;
        next.countdownStartLng = lng;
      }
    } else {
      const distance = haversineMeters(next.countdownStartLat, next.countdownStartLng, lat, lng);
      const violating = distance - accuracy > HUNTER_START_RADIUS_METERS;
      if (violating) {
        next.countdownViolationStartedAt ??= now;
        next.countdownViolation = true;
      } else {
        next.countdownViolationStartedAt = null;
        next.countdownViolation = null;
      }
    }
  } else {
    next.countdownViolationStartedAt = null;
    next.countdownViolation = null;
  }

  return next;
}

export function reconcileLobby(input: Lobby, now: number): Lobby {
  const lobby = structuredClone(input);
  if (lobby.gameState === 'ended' || lobby.result) return lobby;

  const phase = effectivePhase(lobby, now);
  if (phase === 'lobby') return lobby;
  if (phase === 'ended') return finalizeLobby(lobby, now, 'agent', 'time_up');
  if (phase === 'playing') lobby.gameState = 'playing';

  if (phase === 'playing' && lobby.gameStartedAt != null) {
    const elapsedMs = now - lobby.gameStartedAt;
    const intervalMs = lobby.settings.pulseIntervalSec * 1000;
    const overduePulseIndex = Math.floor((elapsedMs - PULSE_GRACE_MS) / intervalMs);
    if (overduePulseIndex >= 1 && (lobby.agentPulseMarker?.pulseIndex ?? 0) < overduePulseIndex) {
      return finalizeLobby(lobby, now, 'none', 'agent_offline_pulse');
    }
  }

  for (const player of Object.values(lobby.players)) {
    if (player.eliminated) continue;
    const lastSeenAt = Number.isFinite(player.lastSeenAt) ? player.lastSeenAt : now;
    if (now - lastSeenAt >= DISCONNECT_THRESHOLD_MS) {
      player.disconnectedAt ??= lastSeenAt + DISCONNECT_THRESHOLD_MS;
    } else {
      player.disconnectedAt = null;
    }
    if (player.disconnectedAt != null && now - player.disconnectedAt >= DISCONNECT_ELIMINATION_MS) {
      player.eliminated = true;
      player.eliminatedReason = 'disconnect_timeout';
    }

    if (!player.eliminated && player.countdownViolationStartedAt != null
      && now - player.countdownViolationStartedAt >= VIOLATION_TIMEOUT_MS) {
      player.eliminated = true;
      player.eliminatedReason = 'movement_restriction';
      player.countdownViolation = null;
    }
    if (!player.eliminated && player.fieldViolationStartedAt != null
      && now - player.fieldViolationStartedAt >= VIOLATION_TIMEOUT_MS) {
      player.eliminated = true;
      player.eliminatedReason = 'field_violation';
      player.fieldViolationActive = null;
    }
  }

  const agent = Object.values(lobby.players).find((player) => player.role === 'agent');
  if (agent?.eliminated) {
    if (agent.eliminatedReason === 'disconnect_timeout') {
      return finalizeLobby(lobby, now, 'hunters', 'agent_disconnected');
    }
    const reason = agent.eliminatedReason === 'movement_restriction' ? 'movement_restriction' : 'field_violation';
    return finalizeLobby(lobby, now, 'hunters', reason);
  }

  const activePlayers = Object.values(lobby.players).filter((player) => !player.eliminated);
  if (activePlayers.length < MIN_PLAYERS) {
    return finalizeLobby(lobby, now, 'none', 'too_few_players');
  }
  return lobby;
}

export function finalizeLobby(
  lobby: Lobby,
  now: number,
  winner: GameResult['winner'],
  reason: GameResultReason,
  caughtByUid?: string
): Lobby {
  if (lobby.result || lobby.gameState === 'ended') return lobby;
  return {
    ...lobby,
    gameState: 'ended',
    result: {
      winner,
      reason,
      ...(caughtByUid ? { caughtByUid } : {}),
      finalizedAt: now
    },
    lastActivityAt: now
  };
}

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const earthRadiusMeters = 6_371_000;
  const degreesToRadians = Math.PI / 180;
  const deltaLat = (lat2 - lat1) * degreesToRadians;
  const deltaLng = (lng2 - lng1) * degreesToRadians;
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1 * degreesToRadians) * Math.cos(lat2 * degreesToRadians) * Math.sin(deltaLng / 2) ** 2;
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
