import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createApiHandler } from '../src/http.js';
import { HttpError } from '../src/errors.js';

function createResponse() {
  const res: any = {
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
  return res;
}

describe('createApiHandler', () => {
  beforeEach(() => {
    process.env.ALLOWED_ORIGINS = 'http://localhost:4200';
  });

  it('returns 401 for missing auth', async () => {
    const handler = createApiHandler(async (_req, res) => {
      throw new HttpError(401, 'UNAUTHORIZED', 'Authorization token missing');
    });

    const req: any = {
      method: 'GET',
      url: '/',
      headers: {}
    };
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.body).toContain('UNAUTHORIZED');
  });

  it('rejects disallowed origins', async () => {
    const handler = createApiHandler(async (_req, _res) => {
      throw new Error('should not run');
    });

    const req: any = {
      method: 'GET',
      url: '/',
      headers: { origin: 'https://evil.example' }
    };
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(403);
    expect(res.body).toContain('Origin not allowed');
  });

  it('parses JSON body for POST requests', async () => {
    const handler = createApiHandler(async (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ received: req.body }));
    });

    const req: any = {
      method: 'POST',
      url: '/',
      headers: { 'content-type': 'application/json' },
      on(event: string, cb: (...args: any[]) => void) {
        if (event === 'data') {
          cb('{"lobbyCode":"abc123"}');
        }
        if (event === 'end') {
          cb();
        }
      }
    };
    const res = createResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('abc123');
  });
});
