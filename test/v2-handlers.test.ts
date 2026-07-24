import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlayer } from '../src/game-repository.js';
import type { Lobby } from '../src/types.js';

const { mockAuthenticateRequest, mockGetDatabase, mockLoadConfig } = vi.hoisted(() => ({
  mockAuthenticateRequest: vi.fn(),
  mockGetDatabase: vi.fn(),
  mockLoadConfig: vi.fn()
}));

vi.mock('../src/auth.js', () => ({ authenticateRequest: mockAuthenticateRequest }));
vi.mock('../src/firebase-admin.js', () => ({ getDatabase: mockGetDatabase }));
vi.mock('../src/config.js', async () => {
  const actual = await vi.importActual<typeof import('../src/config.js')>('../src/config.js');
  return { ...actual, loadConfig: mockLoadConfig };
});

import createLobbyHandler from '../api/lobby/create.js';
import claimAgentHandler from '../api/lobby/claim-agent.js';
import joinLobbyHandler from '../api/lobby/join.js';
import lobbyStateHandler from '../api/lobby/state.js';
import catchHandler from '../api/game/catch.js';
import catchTokenHandler from '../api/game/catch-token.js';
import startHandler from '../api/game/start.js';
import interceptHandler from '../api/game/intercept.js';
import leaveHandler from '../api/game/leave.js';
import positionHandler from '../api/game/position.js';
import positionSessionHandler from '../api/game/position-session.js';
import heartbeatHandler from '../api/game/heartbeat.js';
import pulseHandler from '../api/game/pulse.js';

function request(body: unknown) {
  const serialized = JSON.stringify(body);
  return {
    method: 'POST',
    url: '/',
    headers: {},
    on(event: string, callback: (...args: any[]) => void) {
      if (event === 'data') callback(serialized);
      if (event === 'end') callback();
    }
  };
}

function response() {
  return {
    body: '',
    statusCode: 200,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) { this.headers[name] = value; },
    writeHead(status: number, headers?: Record<string, string>) {
      this.statusCode = status;
      Object.assign(this.headers, headers);
      return this;
    },
    end(body?: string) { this.body = body ?? ''; return this; }
  };
}

function databaseStore(initial: Lobby | null) {
  let value = initial;
  return {
    database: {
      ref: vi.fn(() => ({
        async transaction(update: (current: Lobby | null) => Lobby | null | undefined) {
          const next = update(value);
          if (next === undefined) return { committed: false, snapshot: { val: () => value } };
          value = next;
          return { committed: true, snapshot: { val: () => value } };
        },
        async once() { return { val: () => value }; }
      }))
    },
    value: () => value
  };
}

function waitingLobby(): Lobby {
  const now = Date.now();
  return {
    hostUid: 'host',
    createdAt: now,
    lastActivityAt: now,
    gameState: 'lobby',
    gameStartedAt: null,
    gameField: { north: 51.6, south: 51.5, east: 10.2, west: 10.1 },
    settings: { gameDurationSec: 1800, countdownDurationSec: 240, pulseIntervalSec: 300, agentInterceptEnabled: true },
    players: {
      host: createPlayer('host', 'Host', '#E53935', now),
      second: createPlayer('second', 'Second', '#1E88E5', now)
    }
  };
}

describe('V2 handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateRequest.mockResolvedValue('host');
    mockLoadConfig.mockReturnValue({ catchTokenSecret: '12345678901234567890123456789012' });
  });

  it('creates a complete lobby with server-owned host and timestamps', async () => {
    const store = databaseStore(null);
    mockGetDatabase.mockReturnValue(store.database);
    const res = response();
    await createLobbyHandler(request({
      lobbyCode: 'ABC123',
      gameField: { north: 51.6, south: 51.5, east: 10.2, west: 10.1 },
      settings: { gameDurationSec: 1800, countdownDurationSec: 240, pulseIntervalSec: 300, agentInterceptEnabled: false },
      player: { nickname: 'Host', color: '#e53935' }
    }) as any, res as any);

    expect(res.statusCode).toBe(201);
    expect(store.value()).toMatchObject({ hostUid: 'host', gameState: 'lobby' });
    expect(store.value()!.players.host).toMatchObject({ lastSeenAt: expect.any(Number), accuracy: null });
    expect((store.value() as any).agentBleUuid).toBeUndefined();
  });

  it('rejects a duplicate lobby code without replacing the existing lobby', async () => {
    const current = waitingLobby();
    const store = databaseStore(current);
    mockGetDatabase.mockReturnValue(store.database);
    const res = response();
    await createLobbyHandler(request({
      lobbyCode: 'ABC123',
      gameField: current.gameField,
      settings: current.settings,
      player: { nickname: 'Other', color: '#43A047' }
    }) as any, res as any);

    expect(res.statusCode).toBe(409);
    expect(res.body).toContain('LOBBY_ALREADY_EXISTS');
    expect(store.value()).toEqual(current);
  });

  it('allows exactly one of two concurrent agent claims', async () => {
    const store = databaseStore(waitingLobby());
    mockGetDatabase.mockReturnValue(store.database);
    mockAuthenticateRequest.mockResolvedValueOnce('host').mockResolvedValueOnce('second');
    const first = response();
    const second = response();
    await Promise.all([
      claimAgentHandler(request({ lobbyCode: 'abc123' }) as any, first as any),
      claimAgentHandler(request({ lobbyCode: 'abc123' }) as any, second as any)
    ]);

    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 409]);
    expect(Object.values(store.value()!.players).filter((player) => player.role === 'agent')).toHaveLength(1);
  });

  it('never exceeds six players when two joins race for the final slot', async () => {
    const current = waitingLobby();
    current.players.third = createPlayer('third', 'Third', '#43A047', 3);
    current.players.fourth = createPlayer('fourth', 'Fourth', '#FB8C00', 4);
    current.players.fifth = createPlayer('fifth', 'Fifth', '#8E24AA', 5);
    const store = databaseStore(current);
    mockGetDatabase.mockReturnValue(store.database);
    mockAuthenticateRequest.mockResolvedValueOnce('sixth').mockResolvedValueOnce('seventh');
    const sixth = response();
    const seventh = response();
    await Promise.all([
      joinLobbyHandler(request({ lobbyCode: 'abc123', player: { nickname: 'Sixth', color: '#00ACC1' } }) as any, sixth as any),
      joinLobbyHandler(request({ lobbyCode: 'abc123', player: { nickname: 'Seventh', color: '#00ACC1' } }) as any, seventh as any)
    ]);

    expect([sixth.statusCode, seventh.statusCode].sort()).toEqual([200, 409]);
    expect(Object.keys(store.value()!.players)).toHaveLength(6);
  });

  it('rejects game start by a non-host with a stable 403', async () => {
    const current = waitingLobby();
    current.players.host.role = 'agent';
    const store = databaseStore(current);
    mockGetDatabase.mockReturnValue(store.database);
    mockAuthenticateRequest.mockResolvedValue('second');
    const res = response();
    await startHandler(request({ lobbyCode: 'abc123' }) as any, res as any);
    expect(res.statusCode).toBe(403);
    expect(res.body).toContain('HOST_REQUIRED');
  });

  it('rejects a duplicate nickname during join without changing the lobby', async () => {
    const store = databaseStore(waitingLobby());
    mockGetDatabase.mockReturnValue(store.database);
    mockAuthenticateRequest.mockResolvedValue('third');
    const res = response();
    await joinLobbyHandler(request({
      lobbyCode: 'abc123',
      player: { nickname: ' host ', color: '#43A047' }
    }) as any, res as any);
    expect(res.statusCode).toBe(409);
    expect(res.body).toContain('NICKNAME_TAKEN');
    expect(store.value()!.players.third).toBeUndefined();
  });

  it('returns a no-store catch token only to the active agent', async () => {
    const current = waitingLobby();
    current.gameState = 'countdown';
    current.gameStartedAt = Date.now() - 10_000;
    current.players.host.role = 'agent';
    current.players.second.role = 'hunter';
    const store = databaseStore(current);
    mockGetDatabase.mockReturnValue(store.database);
    const res = response();
    await catchTokenHandler(request({ lobbyCode: 'abc123' }) as any, res as any);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(JSON.parse(res.body).data.token).toMatch(/^v1\./);

    mockAuthenticateRequest.mockResolvedValue('second');
    const hunterResponse = response();
    await catchTokenHandler(request({ lobbyCode: 'abc123' }) as any, hunterResponse as any);
    expect(hunterResponse.statusCode).toBe(403);
  });

  it('returns a filtered no-store lobby state only to members', async () => {
    const current = waitingLobby();
    current.gameState = 'playing';
    current.gameStartedAt = Date.now() - 300_000;
    current.players.host.role = 'agent';
    current.players.host.lat = 51.55;
    current.players.host.lng = 10.15;
    current.players.second.role = 'hunter';
    const store = databaseStore(current);
    mockGetDatabase.mockReturnValue(store.database);
    mockAuthenticateRequest.mockResolvedValue('second');
    const res = response();

    await lobbyStateHandler(request({ lobbyCode: 'abc123' }) as any, res as any);

    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('no-store, private');
    const returnedLobby = JSON.parse(res.body).data.lobby;
    expect(returnedLobby.players.host.lat).toBeNull();
    expect(returnedLobby.players.host.lng).toBeNull();

    mockAuthenticateRequest.mockResolvedValue('outsider');
    const outsiderResponse = response();
    await lobbyStateHandler(request({ lobbyCode: 'abc123' }) as any, outsiderResponse as any);
    expect(outsiderResponse.statusCode).toBe(403);
  });

  it('accepts a position once and treats the repeated sequence as an idempotent no-op', async () => {
    const current = waitingLobby();
    current.gameState = 'countdown';
    current.gameStartedAt = Date.now() - 10_000;
    current.players.host.role = 'agent';
    current.players.second.role = 'hunter';
    const store = databaseStore(current);
    mockGetDatabase.mockReturnValue(store.database);
    const sessionResponse = response();
    await positionSessionHandler(request({ lobbyCode: 'abc123' }) as any, sessionResponse as any);
    expect(sessionResponse.headers['Cache-Control']).toBe('no-store, private');
    const sessionId = JSON.parse(sessionResponse.body).data.sessionId;
    const body = {
      lobbyCode: 'abc123',
      lat: 51.55,
      lng: 10.15,
      accuracy: 5,
      sessionId,
      sequence: 0
    };
    const first = response();
    await positionHandler(request(body) as any, first as any);
    const repeated = response();
    await positionHandler(request(body) as any, repeated as any);
    expect(first.statusCode).toBe(200);
    expect(JSON.parse(repeated.body).data).toEqual({ accepted: false, idempotent: true });
    expect(store.value()!.players.host.positionSequence).toBe(0);
  });

  it('makes the last explicitly issued position session authoritative', async () => {
    const current = waitingLobby();
    current.gameState = 'countdown';
    current.gameStartedAt = Date.now() - 10_000;
    current.players.host.role = 'agent';
    current.players.second.role = 'hunter';
    const store = databaseStore(current);
    mockGetDatabase.mockReturnValue(store.database);

    const firstSessionResponse = response();
    await positionSessionHandler(request({ lobbyCode: 'abc123' }) as any, firstSessionResponse as any);
    const firstSessionId = JSON.parse(firstSessionResponse.body).data.sessionId;
    const secondSessionResponse = response();
    await positionSessionHandler(request({ lobbyCode: 'abc123' }) as any, secondSessionResponse as any);
    const secondSessionId = JSON.parse(secondSessionResponse.body).data.sessionId;

    const stale = response();
    await positionHandler(request({
      lobbyCode: 'abc123', lat: 51.55, lng: 10.15, accuracy: 5, sessionId: firstSessionId, sequence: 0
    }) as any, stale as any);
    expect(stale.statusCode).toBe(409);
    expect(stale.body).toContain('POSITION_SESSION_EXPIRED');

    const active = response();
    await positionHandler(request({
      lobbyCode: 'abc123', lat: 51.55, lng: 10.15, accuracy: 5, sessionId: secondSessionId, sequence: 0
    }) as any, active as any);
    expect(active.statusCode).toBe(200);
    expect(store.value()!.players.host.positionSessionId).toBe(secondSessionId);
  });

  it('updates presence through heartbeat for a member', async () => {
    const current = waitingLobby();
    current.players.host.lastSeenAt = 1;
    current.players.host.disconnectedAt = 2;
    const store = databaseStore(current);
    mockGetDatabase.mockReturnValue(store.database);
    const res = response();
    await heartbeatHandler(request({ lobbyCode: 'abc123' }) as any, res as any);
    expect(res.statusCode).toBe(200);
    expect(store.value()!.players.host.disconnectedAt).toBeNull();
    expect(store.value()!.players.host.lastSeenAt).toBeGreaterThan(1);
  });

  it('returns stable errors for invalid, rate-limited and implausible positions', async () => {
    const now = Date.now();
    const sessionId = '123e4567-e89b-42d3-a456-426614174000';
    const current = waitingLobby();
    current.gameState = 'playing';
    current.gameStartedAt = now - 300_000;
    current.players.host = {
      ...current.players.host,
      role: 'agent',
      lat: 51.55,
      lng: 10.15,
      accuracy: 5,
      positionUpdatedAt: now,
      positionSessionId: sessionId,
      positionSequence: 0
    };
    current.players.second.role = 'hunter';
    const store = databaseStore(current);
    mockGetDatabase.mockReturnValue(store.database);

    const invalid = response();
    await positionHandler(request({ lobbyCode: 'abc123', lat: 91, lng: 10.15, accuracy: 5, sessionId, sequence: 1 }) as any, invalid as any);
    expect(invalid.statusCode).toBe(400);
    expect(invalid.body).toContain('INVALID_INPUT');

    const limited = response();
    await positionHandler(request({ lobbyCode: 'abc123', lat: 51.55, lng: 10.15, accuracy: 5, sessionId, sequence: 1 }) as any, limited as any);
    expect(limited.statusCode).toBe(429);
    expect(limited.body).toContain('POSITION_RATE_LIMITED');

    store.value()!.players.host.positionUpdatedAt = now - 2_000;
    const implausible = response();
    await positionHandler(request({ lobbyCode: 'abc123', lat: 52.55, lng: 10.15, accuracy: 5, sessionId, sequence: 1 }) as any, implausible as any);
    expect(implausible.statusCode).toBe(409);
    expect(implausible.body).toContain('IMPLAUSIBLE_POSITION');
  });

  it('rejects early and duplicate pulses and finalizes an overdue pulse', async () => {
    const now = Date.now();
    const current = waitingLobby();
    current.gameState = 'playing';
    current.gameStartedAt = now - 300_000;
    current.players.host = {
      ...current.players.host,
      role: 'agent', lat: 51.55, lng: 10.15, accuracy: 5, positionUpdatedAt: now
    };
    current.players.second.role = 'hunter';
    const store = databaseStore(current);
    mockGetDatabase.mockReturnValue(store.database);

    const early = response();
    await pulseHandler(request({ lobbyCode: 'abc123', pulseIndex: 2 }) as any, early as any);
    expect(early.statusCode).toBe(409);
    expect(early.body).toContain('PULSE_NOT_DUE');

    const due = response();
    await pulseHandler(request({ lobbyCode: 'abc123', pulseIndex: 1 }) as any, due as any);
    expect(due.statusCode).toBe(200);
    const duplicate = response();
    await pulseHandler(request({ lobbyCode: 'abc123', pulseIndex: 1 }) as any, duplicate as any);
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.body).toContain('INVALID_PULSE');

    store.value()!.gameStartedAt = now - 700_000;
    const overdue = response();
    await heartbeatHandler(request({ lobbyCode: 'abc123' }) as any, overdue as any);
    expect(store.value()!.result).toMatchObject({ winner: 'none', reason: 'agent_offline_pulse' });
  });

  it('returns a stable phase error for a pulse during countdown', async () => {
    const now = Date.now();
    const current = waitingLobby();
    current.gameState = 'countdown';
    current.gameStartedAt = now - 10_000;
    current.players.host = {
      ...current.players.host,
      role: 'agent', lat: 51.55, lng: 10.15, accuracy: 5, positionUpdatedAt: now
    };
    current.players.second.role = 'hunter';
    const store = databaseStore(current);
    mockGetDatabase.mockReturnValue(store.database);
    const res = response();
    await pulseHandler(request({ lobbyCode: 'abc123', pulseIndex: 1 }) as any, res as any);
    expect(res.statusCode).toBe(409);
    expect(res.body).toContain('INVALID_GAME_PHASE');
  });

  it('never overwrites an ended result through heartbeat or position', async () => {
    const sessionId = '123e4567-e89b-42d3-a456-426614174000';
    const current = waitingLobby();
    current.gameState = 'ended';
    current.gameStartedAt = Date.now() - 1_800_000;
    current.result = { winner: 'hunters', reason: 'caught', caughtByUid: 'second', finalizedAt: 1 };
    current.players.host = { ...current.players.host, role: 'agent', positionSessionId: sessionId, positionSequence: -1 };
    current.players.second.role = 'hunter';
    const expectedResult = structuredClone(current.result);
    const store = databaseStore(current);
    mockGetDatabase.mockReturnValue(store.database);

    const heartbeat = response();
    await heartbeatHandler(request({ lobbyCode: 'abc123' }) as any, heartbeat as any);
    expect(store.value()!.result).toEqual(expectedResult);

    const position = response();
    await positionHandler(request({
      lobbyCode: 'abc123', lat: 51.55, lng: 10.15, accuracy: 5, sessionId, sequence: 0
    }) as any, position as any);
    expect(position.statusCode).toBe(409);
    expect(position.body).toContain('GAME_ALREADY_ENDED');
    expect(store.value()!.result).toEqual(expectedResult);
  });

  it('transfers host deterministically to the oldest remaining player', async () => {
    const current = waitingLobby();
    current.players.second.joinedAt = 2;
    current.players.third = createPlayer('third', 'Third', '#43A047', 3);
    const store = databaseStore(current);
    mockGetDatabase.mockReturnValue(store.database);
    const res = response();
    await leaveHandler(request({ lobbyCode: 'abc123' }) as any, res as any);
    expect(res.statusCode).toBe(200);
    expect(store.value()!.hostUid).toBe('second');
    expect(store.value()!.players.host).toBeUndefined();
  });

  it('returns 409 for a repeated intercept instead of a false HTTP 200', async () => {
    const current = waitingLobby();
    const now = Date.now();
    current.gameState = 'playing';
    current.gameStartedAt = now - 300_000;
    current.players.host.role = 'agent';
    current.players.second.role = 'hunter';
    current.agentInterceptUsed = true;
    const store = databaseStore(current);
    mockGetDatabase.mockReturnValue(store.database);
    const res = response();
    await interceptHandler(request({ lobbyCode: 'abc123' }) as any, res as any);
    expect(res.statusCode).toBe(409);
    expect(res.body).toContain('INTERCEPT_ALREADY_USED');
  });

  it('returns 409 for a wrong catch token and preserves the running game', async () => {
    const current = waitingLobby();
    const now = Date.now();
    current.gameState = 'playing';
    current.gameStartedAt = now - 300_000;
    current.players.host.role = 'agent';
    current.players.second.role = 'hunter';
    const store = databaseStore(current);
    mockGetDatabase.mockReturnValue(store.database);
    mockAuthenticateRequest.mockResolvedValue('second');
    const res = response();
    await catchHandler(request({ lobbyCode: 'abc123', scannedToken: `v1.${'A'.repeat(43)}` }) as any, res as any);
    expect(res.statusCode).toBe(409);
    expect(res.body).toContain('INVALID_CATCH_TOKEN');
    expect(store.value()!.result).toBeUndefined();
  });
});
