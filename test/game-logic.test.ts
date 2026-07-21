import { describe, expect, it } from 'vitest';
import { effectivePhase } from '../src/game-repository.js';
import { normalizeLobbyCode, isValidUuid } from '../src/validation.js';

describe('effectivePhase', () => {
  it('returns lobby before start', () => {
    const lobby = {
      gameState: 'lobby',
      gameStartedAt: null,
      settings: { countdownDurationSec: 60, gameDurationSec: 600 }
    } as any;

    expect(effectivePhase(lobby, 1_000)).toBe('lobby');
  });

  it('returns countdown before countdown finishes', () => {
    const lobby = {
      gameState: 'countdown',
      gameStartedAt: 1_000,
      settings: { countdownDurationSec: 60, gameDurationSec: 600 }
    } as any;

    expect(effectivePhase(lobby, 1_000 + 59_000)).toBe('countdown');
  });

  it('returns playing after countdown and before game end', () => {
    const lobby = {
      gameState: 'countdown',
      gameStartedAt: 1_000,
      settings: { countdownDurationSec: 60, gameDurationSec: 600 }
    } as any;

    expect(effectivePhase(lobby, 1_000 + 60_000)).toBe('playing');
  });

  it('returns ended after game duration', () => {
    const lobby = {
      gameState: 'countdown',
      gameStartedAt: 1_000,
      settings: { countdownDurationSec: 60, gameDurationSec: 600 }
    } as any;

    expect(effectivePhase(lobby, 1_000 + 600_000)).toBe('ended');
  });
});

describe('validation helpers', () => {
  it('normalizes and validates lobby codes', () => {
    expect(normalizeLobbyCode(' AbC123 ')).toBe('abc123');
    expect(normalizeLobbyCode('bad!')).toBeNull();
  });

  it('validates UUIDs', () => {
    expect(isValidUuid('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
    expect(isValidUuid('not-a-uuid')).toBe(false);
  });
});
