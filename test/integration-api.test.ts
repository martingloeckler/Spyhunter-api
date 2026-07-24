import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAuthenticateRequest, mockAuthenticateCronRequest, mockGetDatabase, mockLoadConfig } = vi.hoisted(() => ({
  mockAuthenticateRequest: vi.fn(),
  mockAuthenticateCronRequest: vi.fn(),
  mockGetDatabase: vi.fn(),
  mockLoadConfig: vi.fn()
}));

vi.mock('../src/auth.js', () => ({
  authenticateRequest: mockAuthenticateRequest,
  authenticateCronRequest: mockAuthenticateCronRequest
}));

vi.mock('../src/firebase-admin.js', () => ({
  getDatabase: mockGetDatabase
}));

vi.mock('../src/config.js', async () => {
  const actual = await vi.importActual<typeof import('../src/config.js')>('../src/config.js');
  return {
    ...actual,
    loadConfig: mockLoadConfig
  };
});

import healthHandler from '../api/health.js';
import startHandler from '../api/game/start.js';
import cleanupHandler from '../api/maintenance/cleanup-lobbies.js';

function createRequest(method = 'GET', body?: string) {
  return {
    method,
    url: '/',
    headers: {},
    body,
    on(event: string, callback: (...args: any[]) => void) {
      if (event === 'data' && body) {
        callback(body);
      }
      if (event === 'end') {
        callback();
      }
    }
  };
}

function createResponse() {
  return {
    body: '',
    headers: {} as Record<string, string>,
    statusCode: 200,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    writeHead(status: number, headers?: Record<string, string>) {
      this.statusCode = status;
      if (headers) {
        Object.assign(this.headers, headers);
      }
      return this;
    },
    end(body?: string) {
      this.body = body ?? '';
      return this;
    }
  };
}

describe('API integration handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockReturnValue({
      firebaseProjectId: 'demo-project',
      firebaseClientEmail: 'demo@example.com',
      firebasePrivateKey: 'dummy',
      firebaseDatabaseUrl: 'https://demo.firebaseio.com',
      allowedOrigins: ['http://localhost:4200'],
      cronSecret: 'secret',
      catchTokenSecret: '12345678901234567890123456789012'
    });
    mockAuthenticateRequest.mockResolvedValue('user-123');
  });

  it('returns the health payload', async () => {
    const req = createRequest('GET');
    const res = createResponse();

    await healthHandler(req as any, res as any);

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('spyhunt-game-api');
  });

  it('starts a lobby transaction with the authenticated uid', async () => {
    const lobby = {
      hostUid: 'user-123',
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      gameState: 'lobby',
      gameStartedAt: null,
      gameField: { north: 51.6, south: 51.5, east: 10.2, west: 10.1 },
      settings: {
        gameDurationSec: 1800,
        countdownDurationSec: 240,
        pulseIntervalSec: 300,
        agentInterceptEnabled: false
      },
      players: {
        'user-123': { uid: 'user-123', role: 'agent', eliminated: false },
        'user-456': { uid: 'user-456', role: null, eliminated: false }
      }
    };
    const transaction = vi.fn(async (update: (current: any) => any) => {
      const value = update(lobby);
      return { committed: value !== undefined, snapshot: { val: () => value } };
    });
    mockGetDatabase.mockReturnValue({
      ref: vi.fn(() => ({ transaction }))
    });

    const req = createRequest('POST', JSON.stringify({ lobbyCode: 'abc123' }));
    const res = createResponse();

    await startHandler(req as any, res as any);

    expect(mockAuthenticateRequest).toHaveBeenCalled();
    expect(transaction).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('ok');
  });

  it('cleans stale lobbies and skips failures per lobby', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const once = vi.fn()
      .mockResolvedValueOnce({
        val: () => ({
          stale: { createdAt: 1 },
          fresh: { createdAt: Date.now() }
        })
      })
      .mockResolvedValueOnce({
        val: () => ({ createdAt: 1 })
      });

    const query = {
      orderByChild: vi.fn(),
      endAt: vi.fn(),
      limitToFirst: vi.fn(),
      once,
      remove
    };
    query.orderByChild.mockReturnValue(query);
    query.endAt.mockReturnValue(query);
    query.limitToFirst.mockReturnValue(query);
    mockGetDatabase.mockReturnValue({ ref: vi.fn(() => query) });

    const req = createRequest('GET');
    const res = createResponse();

    await cleanupHandler(req as any, res as any);

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('checked');
    expect(res.body).toContain('deleted');
    expect(remove).toHaveBeenCalled();
    expect(query.orderByChild).toHaveBeenCalledWith('createdAt');
    expect(query.limitToFirst).toHaveBeenCalledWith(100);
  });
});
