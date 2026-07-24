import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import app from '../src/index.js';

describe('single Vercel entrypoint', () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server!.close(error => error ? reject(error) : resolve());
    });
    server = undefined;
  });

  async function start(): Promise<string> {
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server!.once('listening', resolve));
    const address = server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
  }

  it('routes the health endpoint through the shared app', async () => {
    const baseUrl = await start();
    const response = await fetch(`${baseUrl}/api/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: { service: 'spyhunt-game-api' }
    });
  });

  it('preserves method validation from existing handlers', async () => {
    const baseUrl = await start();
    const response = await fetch(`${baseUrl}/api/health`, { method: 'POST' });

    expect(response.status).toBe(405);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: 'METHOD_NOT_ALLOWED' }
    });
  });

  it('returns the shared JSON envelope for unknown endpoints', async () => {
    const baseUrl = await start();
    const response = await fetch(`${baseUrl}/api/unknown`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Endpoint not found' }
    });
  });
});
