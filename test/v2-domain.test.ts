import { describe, expect, it } from 'vitest';
import { catchTokensEqual, deriveCatchToken, isCatchTokenFormatValid } from '../src/catch-token.js';
import {
  applyPositionRules,
  createPlayer,
  reconcileLobby
} from '../src/game-repository.js';
import { commitLobby, rejectLobby, runLobbyTransaction } from '../src/lobby-transaction.js';
import type { Lobby } from '../src/types.js';
import {
  isValidGameField,
  isValidGameSettings,
  normalizeNickname,
  normalizePlayerColor
} from '../src/validation.js';

const NOW = 2_000_000;

function lobby(overrides: Partial<Lobby> = {}): Lobby {
  const agent = { ...createPlayer('agent', 'Agent', '#E53935', NOW), role: 'agent' as const };
  const hunter1 = { ...createPlayer('hunter-1', 'Hunter1', '#1E88E5', NOW), role: 'hunter' as const };
  const hunter2 = { ...createPlayer('hunter-2', 'Hunter2', '#43A047', NOW), role: 'hunter' as const };
  return {
    hostUid: 'agent',
    createdAt: NOW,
    lastActivityAt: NOW,
    gameState: 'playing',
    gameStartedAt: NOW - 300_000,
    gameField: { north: 51.6, south: 51.5, east: 10.2, west: 10.1 },
    settings: {
      gameDurationSec: 1_800,
      countdownDurationSec: 60,
      pulseIntervalSec: 300,
      agentInterceptEnabled: true
    },
    players: { agent, 'hunter-1': hunter1, 'hunter-2': hunter2 },
    ...overrides
  };
}

describe('V2 catch tokens', () => {
  const secret = '12345678901234567890123456789012';

  it('derives a versioned deterministic token bound to lobby, start and agent', () => {
    const token = deriveCatchToken(secret, 'abc123', 123, 'agent');
    expect(isCatchTokenFormatValid(token)).toBe(true);
    expect(deriveCatchToken(secret, 'abc123', 123, 'agent')).toBe(token);
    expect(deriveCatchToken(secret, 'abc123', 124, 'agent')).not.toBe(token);
    expect(deriveCatchToken(secret, 'abc123', 123, 'other-agent')).not.toBe(token);
    expect(catchTokensEqual(token, token)).toBe(true);
    expect(catchTokensEqual(token, deriveCatchToken(secret, 'xyz789', 123, 'agent'))).toBe(false);
  });
});

describe('V2 validation', () => {
  it('uses the established app nickname and color contract', () => {
    expect(normalizeNickname('  Max   M. ')).toBe('Max M.');
    expect(normalizeNickname('123456789')).toBeNull();
    expect(normalizePlayerColor('#e53935')).toBe('#E53935');
    expect(normalizePlayerColor('#ffffff')).toBeNull();
  });

  it('validates settings and rejects undersized fields', () => {
    expect(isValidGameSettings({
      gameDurationSec: 1_800,
      countdownDurationSec: 240,
      pulseIntervalSec: 300,
      agentInterceptEnabled: false
    })).toBe(true);
    expect(isValidGameField({ north: 51.6, south: 51.5, east: 10.2, west: 10.1 })).toBe(true);
    expect(isValidGameField({ north: 51.50001, south: 51.5, east: 10.20001, west: 10.2 })).toBe(false);
  });
});

describe('reconcileLobby', () => {
  it('lets the agent win when total game time expires', () => {
    const result = reconcileLobby(lobby({ gameStartedAt: NOW - 1_800_001 }), NOW);
    expect(result.result).toMatchObject({ winner: 'agent', reason: 'time_up' });
  });

  it('eliminates an offline hunter after disconnect threshold and grace period', () => {
    const current = lobby();
    current.players['hunter-1'].lastSeenAt = NOW - 91_000;
    const result = reconcileLobby(current, NOW);
    expect(result.players['hunter-1']).toMatchObject({
      eliminated: true,
      eliminatedReason: 'disconnect_timeout'
    });
    expect(result.result).toBeUndefined();
  });

  it('ends the game when the agent exceeds the disconnect grace period', () => {
    const current = lobby();
    current.players.agent.lastSeenAt = NOW - 91_000;
    const result = reconcileLobby(current, NOW);
    expect(result.players.agent.eliminatedReason).toBe('disconnect_timeout');
    expect(result.result).toMatchObject({ winner: 'hunters', reason: 'agent_disconnected' });
  });

  it('eliminates a hunter after a sustained countdown movement violation', () => {
    const current = lobby({ gameState: 'countdown', gameStartedAt: NOW - 20_000 });
    current.players['hunter-1'].countdownViolation = true;
    current.players['hunter-1'].countdownViolationStartedAt = NOW - 60_001;
    const result = reconcileLobby(current, NOW);
    expect(result.players['hunter-1'].eliminatedReason).toBe('movement_restriction');
  });

  it('never overwrites an existing result', () => {
    const current = lobby({
      gameState: 'ended',
      result: { winner: 'hunters', reason: 'caught', caughtByUid: 'hunter-1', finalizedAt: 1 }
    });
    expect(reconcileLobby(current, NOW + 9_999).result).toEqual(current.result);
  });

  it('tracks field and countdown violations from authoritative positions', () => {
    const current = lobby({ gameState: 'countdown', gameStartedAt: NOW - 10_000 });
    let player = applyPositionRules(current.players['hunter-1'], current, 51.55, 10.15, 5, NOW);
    expect(player.countdownStartLat).toBe(51.55);
    player = applyPositionRules(player, current, 51.56, 10.15, 5, NOW + 2_000);
    expect(player.countdownViolation).toBe(true);
    player = applyPositionRules(player, current, 52, 10.15, 5, NOW + 4_000);
    expect(player.fieldViolationActive).toBe(true);
  });

  it('clears recovered violations and eliminates sustained field violations', () => {
    const current = lobby();
    let player = applyPositionRules(current.players['hunter-1'], current, 52, 10.15, 5, NOW);
    expect(player.fieldViolationStartedAt).toBe(NOW);
    player = applyPositionRules(player, current, 51.55, 10.15, 5, NOW + 1_000);
    expect(player.fieldViolationStartedAt).toBeNull();
    expect(player.fieldViolationActive).toBeNull();

    current.players['hunter-1'].fieldViolationStartedAt = NOW - 60_001;
    current.players['hunter-1'].fieldViolationActive = true;
    const result = reconcileLobby(current, NOW);
    expect(result.players['hunter-1']).toMatchObject({ eliminated: true, eliminatedReason: 'field_violation' });
  });

  it('clears a countdown movement violation when the hunter returns in time', () => {
    const current = lobby({ gameState: 'countdown', gameStartedAt: NOW - 10_000 });
    let player = applyPositionRules(current.players['hunter-1'], current, 51.55, 10.15, 5, NOW);
    player = applyPositionRules(player, current, 51.56, 10.15, 5, NOW + 1_000);
    expect(player.countdownViolationStartedAt).toBe(NOW + 1_000);
    player = applyPositionRules(player, current, 51.55, 10.15, 5, NOW + 2_000);
    expect(player.countdownViolationStartedAt).toBeNull();
    expect(player.countdownViolation).toBeNull();
  });

  it('preserves the first terminal result across later reconciliation causes', () => {
    const current = lobby({
      gameState: 'ended',
      result: { winner: 'agent', reason: 'time_up', finalizedAt: NOW }
    });
    current.players.agent.eliminated = true;
    current.players.agent.eliminatedReason = 'disconnect_timeout';
    expect(reconcileLobby(current, NOW + 1_000).result).toEqual(current.result);
  });
});

describe('lobby transaction outcomes', () => {
  it('preserves a stable rejection instead of turning a no-op into success', async () => {
    const reference = {
      async transaction(update: (current: Lobby | null) => Lobby | null | undefined) {
        const next = update(lobby());
        return { committed: next !== undefined, snapshot: { val: () => next } };
      }
    };
    await expect(runLobbyTransaction(reference, () => rejectLobby(409, 'INVALID_STATE', 'Rejected')))
      .rejects.toMatchObject({ status: 409, code: 'INVALID_STATE' });
  });

  it('returns explicit data for an intentional idempotent no-op', async () => {
    const current = lobby();
    const reference = {
      async transaction(update: (value: Lobby | null) => Lobby | null | undefined) {
        const next = update(current);
        return { committed: next !== undefined, snapshot: { val: () => next } };
      }
    };
    await expect(runLobbyTransaction(reference, (value) => commitLobby(value, { idempotent: true })))
      .resolves.toEqual({ idempotent: true });
  });

  it('uses the outcome from the final Firebase transaction retry', async () => {
    const current = lobby();
    let attempts = 0;
    const reference = {
      async transaction(update: (value: Lobby | null) => Lobby | null | undefined) {
        attempts += 1;
        update(null);
        const next = update(current);
        return { committed: next !== undefined, snapshot: { val: () => next } };
      }
    };
    await expect(runLobbyTransaction(reference, (value) => value
      ? commitLobby(value, { source: 'final' })
      : rejectLobby(404, 'LOBBY_NOT_FOUND', 'Lobby not found'))).resolves.toEqual({ source: 'final' });
    expect(attempts).toBe(1);
  });
});
