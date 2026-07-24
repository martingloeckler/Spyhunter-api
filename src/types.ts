export type GameState = 'lobby' | 'countdown' | 'playing' | 'ended';

export type PlayerRole = 'agent' | 'hunter' | null;

export type EliminationReason =
  | 'field_violation'
  | 'movement_restriction'
  | 'disconnect_timeout'
  | 'voluntary'
  | null;

export type GameResultReason =
  | 'caught'
  | 'time_up'
  | 'agent_left'
  | 'agent_disconnected'
  | 'too_few_players'
  | 'agent_offline_pulse'
  | 'field_violation'
  | 'movement_restriction'
  | 'disconnect_timeout';

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
  joinedAt: number;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  positionUpdatedAt: number | null;
  lastSeenAt: number;
  disconnectedAt: number | null;
  eliminated: boolean;
  eliminatedReason: EliminationReason;
  countdownStartLat: number | null;
  countdownStartLng: number | null;
  countdownViolationStartedAt: number | null;
  countdownViolation: boolean | null;
  fieldViolationStartedAt: number | null;
  fieldViolationActive: boolean | null;
  positionSessionId?: string;
  positionSequence?: number;
}

export interface GameSettings {
  gameDurationSec: number;
  countdownDurationSec: number;
  pulseIntervalSec: number;
  agentInterceptEnabled: boolean;
}

export interface AgentPulseMarker {
  lat: number;
  lng: number;
  pulseIndex: number;
  timestamp: number;
}

export interface GameResult {
  winner: 'hunters' | 'agent' | 'none';
  reason: GameResultReason;
  caughtByUid?: string;
  finalizedAt: number;
}

export interface Lobby {
  hostUid: string;
  createdAt: number;
  lastActivityAt: number;
  gameState: GameState;
  gameStartedAt: number | null;
  gameField: GameField;
  settings: GameSettings;
  players: Record<string, Player>;
  agentInterceptUsed?: boolean;
  agentPulseMarker?: AgentPulseMarker;
  result?: GameResult;
}
