import { MAX_LOBBY_CODE_LENGTH, MIN_LOBBY_CODE_LENGTH } from './config.js';

export function normalizeLobbyCode(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9]{6,8}$/.test(normalized)) {
    return null;
  }
  return normalized;
}

export function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
