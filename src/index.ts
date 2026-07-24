import type { IncomingMessage, ServerResponse } from 'node:http';
import express, { type NextFunction, type Request, type Response } from 'express';
import catchHandler from '../api/game/catch.js';
import catchTokenHandler from '../api/game/catch-token.js';
import heartbeatHandler from '../api/game/heartbeat.js';
import interceptHandler from '../api/game/intercept.js';
import leaveHandler from '../api/game/leave.js';
import positionHandler from '../api/game/position.js';
import positionSessionHandler from '../api/game/position-session.js';
import pulseHandler from '../api/game/pulse.js';
import startHandler from '../api/game/start.js';
import healthHandler from '../api/health.js';
import checkLobbyHandler from '../api/lobby/check.js';
import claimAgentHandler from '../api/lobby/claim-agent.js';
import createLobbyHandler from '../api/lobby/create.js';
import joinLobbyHandler from '../api/lobby/join.js';
import releaseAgentHandler from '../api/lobby/release-agent.js';
import lobbyStateHandler from '../api/lobby/state.js';
import cleanupLobbiesHandler from '../api/maintenance/cleanup-lobbies.js';
import { failure } from './responses.js';

type ExistingApiHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

const app = express();
app.disable('x-powered-by');

// Do not install express.json() here. Existing handlers enforce the shared
// 16 KiB request limit while reading the original request stream themselves.
function mount(path: string, handler: ExistingApiHandler): void {
  app.all(path, (req: Request, res: Response, next: NextFunction) => {
    void handler(req, res).catch(next);
  });
}

mount('/api/health', healthHandler);

mount('/api/lobby/create', createLobbyHandler);
mount('/api/lobby/check', checkLobbyHandler);
mount('/api/lobby/state', lobbyStateHandler);
mount('/api/lobby/join', joinLobbyHandler);
mount('/api/lobby/claim-agent', claimAgentHandler);
mount('/api/lobby/release-agent', releaseAgentHandler);

mount('/api/game/start', startHandler);
mount('/api/game/position-session', positionSessionHandler);
mount('/api/game/position', positionHandler);
mount('/api/game/heartbeat', heartbeatHandler);
mount('/api/game/catch-token', catchTokenHandler);
mount('/api/game/catch', catchHandler);
mount('/api/game/pulse', pulseHandler);
mount('/api/game/intercept', interceptHandler);
mount('/api/game/leave', leaveHandler);

mount('/api/maintenance/cleanup-lobbies', cleanupLobbiesHandler);
mount('/api/spyhuntgame', cleanupLobbiesHandler);

app.use((_req, res) => {
  res.status(404).json(failure('NOT_FOUND', 'Endpoint not found'));
});

app.use((_error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) return;
  res.status(500).json(failure('INTERNAL_ERROR', 'An unexpected error occurred'));
});

export default app;
