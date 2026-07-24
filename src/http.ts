import type { IncomingMessage, ServerResponse } from 'node:http';
import { createRequestId, MAX_BODY_SIZE } from './config.js';
import { HttpError } from './errors.js';
import { failure } from './responses.js';
import type { ApiResponse } from './responses.js';

export type HttpRequest = IncomingMessage & {
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
};

export type HttpHandler = (req: HttpRequest, res: ServerResponse, ctx: { requestId: string }) => Promise<void>;

export interface ApiHandlerOptions {
  methods?: ReadonlyArray<'GET' | 'POST'>;
}

export function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;

    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      callback();
    };

    req.on('data', (chunk: Buffer | string) => {
      if (settled) return;
      const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8');
      size += chunkBuffer.byteLength;
      if (size > MAX_BODY_SIZE) {
        chunks.length = 0;
        settle(() => reject(new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Request body too large')));
        return;
      }
      chunks.push(chunkBuffer);
    });

    req.on('end', () => {
      if (settled) return;
      const body = Buffer.concat(chunks, size).toString('utf8');
      if (!body) {
        settle(() => resolve({}));
        return;
      }
      try {
        const parsed = JSON.parse(body);
        settle(() => resolve(parsed));
      } catch {
        settle(() => reject(new HttpError(400, 'INVALID_JSON', 'Request body must be valid JSON')));
      }
    });

    req.on('error', () => settle(() => reject(new HttpError(400, 'INVALID_BODY', 'Could not read request body'))));
  });
}

export function createApiHandler(handler: HttpHandler, options: ApiHandlerOptions = {}) {
  return async function (req: IncomingMessage, res: ServerResponse): Promise<void> {
    const requestId = createRequestId();
    const request = req as HttpRequest;

    try {
      const method = (request.method ?? 'GET').toUpperCase();
      const origin = Array.isArray(request.headers.origin) ? request.headers.origin[0] : request.headers.origin;

      if (origin) appendVaryOrigin(res);

      if (origin && !isAllowedOrigin(origin)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(failure('FORBIDDEN', 'Origin not allowed')));
        return;
      }

      if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('X-Request-Id', requestId);

      if (method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const allowedMethods = options.methods ?? ['GET', 'POST'];
      if (!allowedMethods.includes(method as 'GET' | 'POST')) {
        throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
      }

      if (method === 'POST') {
        request.body = await readJsonBody(request);
      }

      await handler(request, res, { requestId });
    } catch (error) {
      const httpError = error instanceof HttpError ? error : new HttpError(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
      const response: ApiResponse = httpError.status >= 500 ? failure(httpError.code, 'An unexpected error occurred') : failure(httpError.code, httpError.message);
      res.writeHead(httpError.status, { 'Content-Type': 'application/json', 'X-Request-Id': requestId });
      res.end(JSON.stringify(response));
    }
  };
}

function appendVaryOrigin(res: ServerResponse): void {
  const current = res.getHeader?.('Vary');
  const values = (Array.isArray(current) ? current : String(current ?? '').split(','))
    .map((value) => String(value).trim())
    .filter(Boolean);
  if (!values.some((value) => value.toLowerCase() === 'origin')) values.push('Origin');
  res.setHeader('Vary', values.join(', '));
}

function isAllowedOrigin(origin: string | string[] | undefined): boolean {
  if (!origin) return true;
  const normalizedOrigin = Array.isArray(origin) ? origin[0] : origin;
  const config = process.env.ALLOWED_ORIGINS ?? '';
  const allowed = config.split(',').map((value) => value.trim()).filter(Boolean);
  return allowed.includes(normalizedOrigin);
}
