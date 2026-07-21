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

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;

    req.on('data', (chunk: Buffer | string) => {
      const chunkString = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      size += Buffer.byteLength(chunkString);
      if (size > MAX_BODY_SIZE) {
        reject(new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Request body too large'));
        return;
      }
      body += chunkString;
    });

    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new HttpError(400, 'INVALID_JSON', 'Request body must be valid JSON'));
      }
    });

    req.on('error', () => reject(new HttpError(400, 'INVALID_BODY', 'Could not read request body')));
  });
}

export function createApiHandler(handler: HttpHandler) {
  return async function (req: IncomingMessage, res: ServerResponse): Promise<void> {
    const requestId = createRequestId();
    const request = req as HttpRequest;

    try {
      const method = (request.method ?? 'GET').toUpperCase();
      const origin = Array.isArray(request.headers.origin) ? request.headers.origin[0] : request.headers.origin;

      if (origin && !isAllowedOrigin(origin)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(failure('FORBIDDEN', 'Origin not allowed')));
        return;
      }

      res.setHeader('Access-Control-Allow-Origin', origin ?? '*');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('X-Request-Id', requestId);

      if (method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (method !== 'GET' && method !== 'POST') {
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

function isAllowedOrigin(origin: string | string[] | undefined): boolean {
  if (!origin) return true;
  const normalizedOrigin = Array.isArray(origin) ? origin[0] : origin;
  const config = process.env.ALLOWED_ORIGINS ?? '';
  const allowed = config.split(',').map((value) => value.trim()).filter(Boolean);
  return allowed.includes(normalizedOrigin);
}
