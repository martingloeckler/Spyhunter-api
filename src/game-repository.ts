import { MAX_PLAYERS, MIN_PLAYERS, PULSE_FRESHNESS_WINDOW_MS } from './config.js';
import type { GameState, Lobby, Player } from './types.js';

export function effectivePhase(lobby: Pick<Lobby, 'gameState' | 'gameStartedAt' | 'settings'>, now: number): GameState {
  if (lobby.gameState === 'ended') return 'ended';
  if (lobby.gameState === 'lobby' || lobby.gameStartedAt == null) return 'lobby';

  const elapsedSec = Math.floor((now - lobby.gameStartedAt) / 1000);
  if (elapsedSec < lobby.settings.countdownDurationSec) return 'countdown';
  if (elapsedSec < lobby.settings.gameDurationSec) return 'playing';
  return 'ended';
}

export function isPlayerActive(player: Player | undefined): boolean {
  return !!player && !player.eliminated;
}

export function canAgentPulse(player: Player | undefined, now: number, pulseIndex: number, lastPulseIndex: number | undefined, pulseIntervalSec: number): boolean {
  if (!player) return false;
  if (player.role !== 'agent') return false;
  if (player.lat == null || player.lng == null || player.positionUpdatedAt == null) return false;
  if (now - player.positionUpdatedAt > PULSE_FRESHNESS_WINDOW_MS) return false;
  if (pulseIndex <= (lastPulseIndex ?? 0)) return false;
  return pulseIndex >= 1 && pulseIndex <= 30;
}

export function validateLobbySettings(lobby: Pick<Lobby, 'settings' | 'gameField'>): boolean {
  const { settings, gameField } = lobby;
  return (
    settings.gameDurationSec >= 600 &&
    settings.gameDurationSec <= 3600 &&
    settings.countdownDurationSec >= 60 &&
    settings.countdownDurationSec <= 600 &&
    settings.countdownDurationSec < settings.gameDurationSec &&
    settings.pulseIntervalSec >= 120 &&
    settings.pulseIntervalSec <= 900 &&
    settings.pulseIntervalSec <= settings.gameDurationSec &&
    gameField.north >= gameField.south &&
    gameField.east >= gameField.west
  );
}

export function validatePlayerCount(players: Record<string, Player>): boolean {
  const playerIds = Object.keys(players).filter((id) => !players[id].eliminated);
  return playerIds.length >= MIN_PLAYERS && playerIds.length <= MAX_PLAYERS;
}

export function countAgents(players: Record<string, Player>): number {
  return Object.values(players).filter((player) => player.role === 'agent' && !player.eliminated).length;
}
