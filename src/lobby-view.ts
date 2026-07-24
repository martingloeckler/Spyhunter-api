import type { Lobby, Player } from './types.js';

export type PlayerView = Omit<Player, 'positionSessionId' | 'positionSequence'>;
export type LobbyView = Omit<Lobby, 'players'> & { players: Record<string, PlayerView> };

/** Builds the least-privilege lobby state visible to one authenticated member. */
export function createLobbyView(lobby: Lobby, viewerUid: string): LobbyView {
  const viewerIsAgent = lobby.players[viewerUid]?.role === 'agent';
  const players = Object.fromEntries(Object.entries(lobby.players).map(([uid, player]) => [
    uid,
    createPlayerView(player, uid === viewerUid || viewerIsAgent || player.role !== 'agent')
  ]));

  // Keep this as an explicit allowlist: values read from RTDB can contain fields
  // that are absent from the compile-time Lobby type (for example legacy data).
  return {
    hostUid: lobby.hostUid,
    createdAt: lobby.createdAt,
    lastActivityAt: lobby.lastActivityAt,
    gameState: lobby.gameState,
    gameStartedAt: lobby.gameStartedAt,
    gameField: { ...lobby.gameField },
    settings: { ...lobby.settings },
    players,
    ...(lobby.agentInterceptUsed !== undefined ? { agentInterceptUsed: lobby.agentInterceptUsed } : {}),
    ...(lobby.agentPulseMarker ? { agentPulseMarker: { ...lobby.agentPulseMarker } } : {}),
    ...(lobby.result ? { result: { ...lobby.result } } : {})
  };
}

function createPlayerView(player: Player, maySeePosition: boolean): PlayerView {
  return {
    uid: player.uid,
    nickname: player.nickname,
    color: player.color,
    role: player.role,
    joinedAt: player.joinedAt,
    lat: maySeePosition ? player.lat : null,
    lng: maySeePosition ? player.lng : null,
    accuracy: maySeePosition ? player.accuracy : null,
    positionUpdatedAt: maySeePosition ? player.positionUpdatedAt : null,
    lastSeenAt: player.lastSeenAt,
    disconnectedAt: player.disconnectedAt,
    eliminated: player.eliminated,
    eliminatedReason: player.eliminatedReason,
    countdownStartLat: player.countdownStartLat,
    countdownStartLng: player.countdownStartLng,
    countdownViolationStartedAt: player.countdownViolationStartedAt,
    countdownViolation: player.countdownViolation,
    fieldViolationStartedAt: player.fieldViolationStartedAt,
    fieldViolationActive: player.fieldViolationActive
  };
}
