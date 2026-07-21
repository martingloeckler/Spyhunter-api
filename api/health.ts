import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApiHandler } from '../src/http.js';
import { success } from '../src/responses.js';

export default createApiHandler(async (_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(success({ service: 'spyhunt-game-api' })));
});
