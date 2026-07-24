import { describe, expect, it, vi } from 'vitest';
import { MAX_BODY_SIZE } from '../src/config.js';
import { createApiHandler, readJsonBody } from '../src/http.js';

function response() {
  return {
    body: '',
    statusCode: 200,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) { this.headers[name] = value; },
    getHeader(name: string) { return this.headers[name]; },
    writeHead(status: number, headers?: Record<string, string>) {
      this.statusCode = status;
      Object.assign(this.headers, headers);
      return this;
    },
    end(body?: string) { this.body = body ?? ''; return this; }
  };
}

function request(origin?: string, chunks: unknown[] = []) {
  return {
    method: chunks.length ? 'POST' : 'GET',
    headers: origin ? { origin } : {},
    on(event: string, callback: (...args: any[]) => void) {
      if (event === 'data') chunks.forEach((chunk) => callback(chunk));
      if (event === 'end') callback();
    }
  };
}

describe('HTTP boundary', () => {
  it('returns 413 and stops inspecting chunks after the size limit is exceeded', async () => {
    const inspected = vi.fn();
    const hostileChunk = {
      valueOf() { inspected(); throw new Error('must not inspect later chunks'); }
    };
    const req = request(undefined, [Buffer.alloc(MAX_BODY_SIZE + 1), hostileChunk]);

    await expect(readJsonBody(req as any)).rejects.toMatchObject({ status: 413, code: 'PAYLOAD_TOO_LARGE' });
    expect(inspected).not.toHaveBeenCalled();

    const handler = createApiHandler(async (_request, res) => {
      res.writeHead(200);
      res.end();
    }, { methods: ['POST'] });
    const res = response();
    await handler(request(undefined, [Buffer.alloc(MAX_BODY_SIZE + 1), Buffer.alloc(MAX_BODY_SIZE)]) as any, res as any);
    expect(res.statusCode).toBe(413);
    expect(res.body).toContain('PAYLOAD_TOO_LARGE');
  });

  it('allows only configured origins and varies dynamic CORS responses by Origin', async () => {
    const previous = process.env.ALLOWED_ORIGINS;
    process.env.ALLOWED_ORIGINS = 'http://localhost:4200,https://localhost,capacitor://localhost';
    try {
      const handler = createApiHandler(async (_request, res) => {
        res.writeHead(200);
        res.end('ok');
      }, { methods: ['GET'] });

      for (const origin of ['http://localhost:4200', 'https://localhost', 'capacitor://localhost']) {
        const allowed = response();
        await handler(request(origin) as any, allowed as any);
        expect(allowed.statusCode).toBe(200);
        expect(allowed.headers['Access-Control-Allow-Origin']).toBe(origin);
        expect(allowed.headers.Vary).toContain('Origin');
      }

      const denied = response();
      await handler(request('https://evil.example') as any, denied as any);
      expect(denied.statusCode).toBe(403);
      expect(denied.headers['Access-Control-Allow-Origin']).toBeUndefined();
      expect(denied.headers.Vary).toContain('Origin');

      const noOrigin = response();
      await handler(request() as any, noOrigin as any);
      expect(noOrigin.headers['Access-Control-Allow-Origin']).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.ALLOWED_ORIGINS;
      else process.env.ALLOWED_ORIGINS = previous;
    }
  });
});
