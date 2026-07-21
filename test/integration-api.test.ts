import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAuthenticateRequest, mockGetDatabase, mockLoadConfig } = vi.hoisted(() => ({
  mockAuthenticateRequest: vi.fn(),
  mockGetDatabase: vi.fn(),
  mockLoadConfig: vi.fn()
}));

vi.mock('../src/auth.js', () => ({
  authenticateRequest: mockAuthenticateRequest
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
      cronSecret: 'secret'
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
    const transaction = vi.fn().mockResolvedValue({
      committed: true,
      snapshot: { val: () => ({ gameState: 'countdown' }) }
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
    mockAuthenticateRequest.mockResolvedValue('cron');
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

    mockGetDatabase.mockReturnValue({
      ref: vi.fn(() => ({ once, remove }))
    });

    const req = createRequest('GET');
    const res = createResponse();

    await cleanupHandler(req as any, res as any);

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('checked');
    expect(res.body).toContain('deleted');
    expect(remove).toHaveBeenCalled();
  });
});
