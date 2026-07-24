import { describe, expect, it } from 'vitest';
import { createLobbyView } from '../src/lobby-view.js';
import { createPlayer } from '../src/game-repository.js';
import type { Lobby, Player } from '../src/types.js';

const now = 1_000_000;

function lobby(): Lobby {
  return {
    hostUid: 'agent',
    createdAt: now,
    lastActivityAt: now,
    gameState: 'playing',
    gameStartedAt: now - 300_000,
    gameField: { north: 51.6, south: 51.5, east: 10.2, west: 10.1 },
    settings: {
      gameDurationSec: 1_800,
      countdownDurationSec: 240,
      pulseIntervalSec: 300,
      agentInterceptEnabled: true
    },
    players: {
      agent: {
        ...createPlayer('agent', 'Agent', '#E53935', now),
        role: 'agent',
        lat: 51.55,
        lng: 10.15,
        accuracy: 5,
        positionUpdatedAt: now,
        positionSessionId: 'private-session',
        positionSequence: 12
      },
      hunter: {
        ...createPlayer('hunter', 'Hunter', '#1E88E5', now),
        role: 'hunter',
        lat: 51.56,
        lng: 10.16,
        accuracy: 6,
        positionUpdatedAt: now,
        positionSessionId: 'hunter-session',
        positionSequence: 8
      }
    }
  };
}

describe('createLobbyView', () => {
  it('hides the live agent position from hunters', () => {
    const view = createLobbyView(lobby(), 'hunter');
    expect(view.players.agent).toMatchObject({
      lat: null,
      lng: null,
      accuracy: null,
      positionUpdatedAt: null
    });
    expect(view.players.hunter).toMatchObject({ lat: 51.56, lng: 10.16 });
  });

  it('lets the agent see hunter positions', () => {
    const view = createLobbyView(lobby(), 'agent');
    expect(view.players.agent).toMatchObject({ lat: 51.55, lng: 10.15 });
    expect(view.players.hunter).toMatchObject({ lat: 51.56, lng: 10.16 });
  });

  it('never returns internal position session state', () => {
    const view = createLobbyView(lobby(), 'agent');
    expect('positionSessionId' in view.players.agent).toBe(false);
    expect('positionSequence' in view.players.agent).toBe(false);
    expect('positionSessionId' in view.players.hunter).toBe(false);
    expect('positionSequence' in view.players.hunter).toBe(false);
  });

  it('drops unknown legacy and future fields instead of forwarding them', () => {
    const current = lobby() as Lobby & { agentBleUuid: string; futureSecret: string };
    current.agentBleUuid = 'legacy-catch-secret';
    current.futureSecret = 'internal-only';
    (current.players.agent as Player & { internalFlag: string }).internalFlag = 'private';

    const view = createLobbyView(current, 'hunter') as unknown as Record<string, any>;
    expect(view.agentBleUuid).toBeUndefined();
    expect(view.futureSecret).toBeUndefined();
    expect(view.players.agent.internalFlag).toBeUndefined();
  });

  it('retains the intentional public pulse marker as a historical game signal', () => {
    const current = lobby();
    current.agentPulseMarker = { lat: 51.54, lng: 10.14, pulseIndex: 1, timestamp: now - 1_000 };
    const view = createLobbyView(current, 'hunter');
    expect(view.agentPulseMarker).toEqual(current.agentPulseMarker);
    expect(view.players.agent.lat).toBeNull();
  });
});
