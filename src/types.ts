export type GameState = 'lobby' | 'countdown' | 'playing' | 'ended';

export type PlayerRole = 'agent' | 'hunter' | null;

export type EliminationReason = 'field_violation' | 'movement_restriction' | 'disconnect_timeout' | 'voluntary' | null;

export interface GameField {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface Player {
  uid: string;
  nickname: string;
  color: string;
  role: PlayerRole;
  lat: number | null;
  lng: number | null;
  positionUpdatedAt: number | null;
  disconnectedAt: number | null;
  eliminated: boolean;
  eliminatedReason: EliminationReason;
  countdownViolation: boolean | null;
  fieldViolationActive: boolean | null;
}

export interface LobbySettings {
  gameDurationSec: number;
  countdownDurationSec: number;
  pulseIntervalSec: number;
  agentInterceptEnabled: boolean;
}

export interface Lobby {
  createdAt: number;
  lastActivityAt: number;
  gameState: GameState;
  gameStartedAt: number | null;
  gameField: GameField;
  settings: LobbySettings;
  agentBleUuid: string | null;
  players: Record<string, Player>;
  agentInterceptUsed?: boolean;
  agentPulseMarker?: {
    lat: number;
    lng: number;
    pulseIndex: number;
    timestamp: number;
  };
  result?: {
    winner: 'hunters' | 'agent' | 'none';
    reason: string;
    caughtByUid?: string;
    finalizedAt: number;
  };
}
