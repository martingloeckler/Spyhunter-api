import { authenticateRequest } from '../../src/auth.js';
import { HttpError } from '../../src/errors.js';
import { getDatabase } from '../../src/firebase-admin.js';
import { effectivePhase, finalizeLobby, reconcileLobby } from '../../src/game-repository.js';
import { createApiHandler } from '../../src/http.js';
import { commitLobby, rejectLobby, runLobbyTransaction } from '../../src/lobby-transaction.js';
import { success } from '../../src/responses.js';
import type { Player } from '../../src/types.js';
import { assertOnlyFields, normalizeLobbyCode } from '../../src/validation.js';

interface LeaveOutcome {
  lobbyDeleted?: boolean;
  hostUid?: string;
  idempotent?: boolean;
  result?: unknown;
}

export default createApiHandler(async (req, res) => {
  const uid = await authenticateRequest(req);
  assertOnlyFields(req.body, ['lobbyCode']);
  const lobbyCode = normalizeLobbyCode(String(req.body.lobbyCode ?? ''));
  if (!lobbyCode) throw new HttpError(400, 'INVALID_INPUT', 'Invalid lobbyCode');
  const now = Date.now();

  const data = await runLobbyTransaction<LeaveOutcome>(getDatabase().ref(`lobbies/${lobbyCode}`), (current) => {
    if (!current) return rejectLobby(404, 'LOBBY_NOT_FOUND', 'Lobby not found');
    const player = current.players?.[uid];
    if (!player) return rejectLobby(403, 'NOT_LOBBY_MEMBER', 'Lobby membership required');
    const phase = effectivePhase(current, now);

    if (phase === 'lobby') {
      const players = { ...current.players };
      delete players[uid];
      if (Object.keys(players).length === 0) return commitLobby(null, { lobbyDeleted: true });
      let hostUid = current.hostUid;
      if (hostUid === uid) hostUid = oldestPlayer(players).uid;
      return commitLobby({ ...current, hostUid, players, lastActivityAt: now }, { lobbyDeleted: false, hostUid });
    }

    const reconciled = reconcileLobby(current, now);
    if (reconciled.result || reconciled.gameState === 'ended') {
      return commitLobby(reconciled, { idempotent: true, result: reconciled.result ?? null });
    }
    const currentPlayer = reconciled.players[uid];
    if (currentPlayer.eliminated) return commitLobby(reconciled, { idempotent: true, result: null });
    if (currentPlayer.role === 'agent') {
      const ended = finalizeLobby(reconciled, now, 'none', 'agent_left');
      return commitLobby(ended, { idempotent: false, result: ended.result ?? null });
    }

    const players = {
      ...reconciled.players,
      [uid]: { ...currentPlayer, eliminated: true, eliminatedReason: 'voluntary' as const }
    };
    const updated = reconcileLobby({ ...reconciled, players, lastActivityAt: now }, now);
    return commitLobby(updated, { idempotent: false, result: updated.result ?? null });
  });

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(success(data)));
}, { methods: ['POST'] });

function oldestPlayer(players: Record<string, Player>): Player {
  return Object.values(players).sort((left, right) => {
    const joinedDifference = (left.joinedAt ?? Number.MAX_SAFE_INTEGER) - (right.joinedAt ?? Number.MAX_SAFE_INTEGER);
    return joinedDifference || left.uid.localeCompare(right.uid);
  })[0];
}
